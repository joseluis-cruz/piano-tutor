/** Piano Tutor - backend Web MIDI aislado en un iframe descartable. */
import { PT_EVENT } from '../core/pt_events.js';
import { metronomeVoice } from '../core/pt_metronome.js';
export { PT_EVENT } from '../core/pt_events.js';
export const PT_MIDI_EVENT = PT_EVENT;
export const PT_PLAYBACK_STATE = Object.freeze({ STOPPED:'STOPPED', PLAYING:'PLAYING', PAUSED:'PAUSED' });

// Tiempo máximo sin recibir MIDI IN cuando THRU es el único motivo para mantener activo MIDI.
const MIDI_THRU_INACTIVITY_TIMEOUT_SECONDS = 60;
const MIDI_FRAME_URL = 'midi-frame.html';

// Sólo la actividad interpretativa de notas y pedales reinicia el timeout de THRU.
const MIDI_PEDAL_CONTROLLERS = new Set([64, 66, 67]); // Sustain, sostenuto y pedal suave.

let frame=null, frameReady=null, requestSerial=0;
const pendingRequests=new Map();
let knownInputs=[], knownOutputs=[], selectedInputId='', selectedOutputId='';
let midiThru=false, thruTimer=null, autoStopCallback=null;
let midiInputObserver=null;
export function setMidiInputObserver(callback){midiInputObserver=typeof callback==='function'?callback:null;}
export function sendLiveMetronomeNote(pitch, velocity=80, durationMs=90){
  if(!frame)return false;
  const voice=metronomeVoice(pitch);
  executeNote({...voice,velocity,timeOn:0,timeOff:durationMs});
  console.log('[ACTIVE] MIDI OUT NOTE_ON', {channel:voice.channel+1,pitch:voice.pitch,velocity}); //debug.midi.active-listening
  return true;
}
let queueTimer=null; const activeTimeouts=new Set(), activeNotes=new Map();
let playbackToken=0, playbackState=PT_PLAYBACK_STATE.STOPPED, playback=null;
let recording=false, recordingStartedAt=0, recordingPausedDuration=0, recordingPauseStartedAt=null, capturedEvents=[]; const capturedOpenNotes=new Map();

function post(command,data={}){frame?.contentWindow?.postMessage({source:'piano-tutor-parent',command,...data},location.origin);}
function request(command,data={}){return new Promise((resolve,reject)=>{const requestId=++requestSerial;pendingRequests.set(requestId,{resolve,reject});post(command,{...data,requestId});});}
function handleFrameMessage(event){if(event.origin!==location.origin||event.data?.source!=='piano-tutor-midi')return;const m=event.data;
  if(m.type==='READY'){frameReady?.resolve?.();return;}
  if(m.type==='RESPONSE'){const p=pendingRequests.get(m.requestId);if(!p)return;pendingRequests.delete(m.requestId);m.error?p.reject(new Error(m.error)):p.resolve(m.result);return;}
  if(m.type==='MIDI_MESSAGE')handleMidiInput(m.data);
}
window.addEventListener('message',handleFrameMessage);

async function ensureMidiContext(trigger='unspecified'){
  if(frame){
    //debug.midi.lifecycle console.log(`[PT MIDI] Reusing MIDI iframe — trigger: ${trigger}`);
    return frameReady.promise;
  }
  //debug.midi.lifecycle console.log(`[PT MIDI] Creating MIDI iframe — trigger: ${trigger}`);
  frame=document.createElement('iframe');frame.hidden=true;frame.setAttribute('allow',"midi 'self'");frame.src=MIDI_FRAME_URL;
  let resolveReady,rejectReady;const promise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});frameReady={promise,resolve:resolveReady,reject:rejectReady};
  document.body.appendChild(frame);await promise;
  //debug.midi.lifecycle console.log('[PT MIDI] MIDI iframe ready');
  return promise;
}
function destroyMidiContext(reason='no MIDI users remain'){
  if(!frame)return;
  //debug.midi.lifecycle console.log(`[PT MIDI] Destroying MIDI iframe — reason: ${reason}`);
  clearThruTimer('MIDI context destruction');for(const p of pendingRequests.values())p.reject(new Error('Contexto MIDI destruido.'));pendingRequests.clear();
  frame.remove();frame=null;frameReady=null;midiThru=false;
  //debug.midi.lifecycle console.log('[PT MIDI] MIDI iframe destroyed');
}
export const isMidiContextActive=()=>Boolean(frame);
export function setMidiAutoStopCallback(callback){autoStopCallback=typeof callback==='function'?callback:null;}

export async function refreshMidiDevices(){
  if(frame)throw new Error('No se pueden actualizar los dispositivos mientras el sistema MIDI está activo.');
  await ensureMidiContext('device discovery');
  try{const result=await request('DISCOVER');knownInputs=result.inputs??[];knownOutputs=result.outputs??[];return {inputs:[...knownInputs],outputs:[...knownOutputs]};}
  finally{destroyMidiContext('device discovery complete');}
}
// Compatibilidad: la inicialización ahora sólo hace un descubrimiento temporal.
export async function initMidi(){try{await refreshMidiDevices();return true;}catch(error){console.error('[MIDI] No se pudo descubrir Web MIDI:',error);return false;}}
export const getMidiInputs=()=>[...knownInputs]; export const getMidiOutputs=()=>[...knownOutputs];
export const getInputDevice=()=>knownInputs.find(p=>p.id===selectedInputId)??null;
export const getOutputDevice=()=>knownOutputs.find(p=>p.id===selectedOutputId)??null;
export const getPlaybackState=()=>playbackState;
export function setInputDevice(id){selectedInputId=id||'';return getInputDevice();}
export function setOutputDevice(id){selectedOutputId=id||'';return getOutputDevice();}
export const getMidiInput=getInputDevice,getMidiOutput=getOutputDevice,selectMidiInput=setInputDevice,selectMidiOutput=setOutputDevice;

export async function openSelectedMidiPorts(trigger='playback'){
  await ensureMidiContext(trigger);
  const result=await request('OPEN',{inputId:selectedInputId,outputId:selectedOutputId});
  if(midiThru)await request('THRU',{enabled:true});
  console.log('[MIDI] Contexto y puertos preparados.',result);
  return result;
}
async function closeMidiPorts(){if(!frame)return;try{await request('CLOSE');}catch(error){console.warn('[MIDI] Error cerrando puertos:',error);}}
export async function stopAndCloseMidi(){panic();if(recording)stopRecording();await closeMidiPorts();destroyMidiContext('forced MIDI shutdown');}
export async function stopMidiSession(){
  panic();if(recording)stopRecording();
  if(midiThru){
    //debug.midi.lifecycle console.log('[PT MIDI] Session stopped — MIDI THRU still active, keeping iframe');
    scheduleThruTimer('session stopped');
    return;
  }
  await closeMidiPorts();destroyMidiContext('session stopped; no MIDI users remain');
}

export async function setMidiThru(enabled){
  const wanted=Boolean(enabled);
  if(wanted){
    if(!selectedInputId||!selectedOutputId)throw new Error('MIDI THRU necesita dispositivos MIDI IN y OUT.');
    midiThru=true;await openSelectedMidiPorts('MIDI THRU');await request('THRU',{enabled:true});scheduleThruTimer('MIDI THRU enabled');
  }else{
    midiThru=false;clearThruTimer();if(frame)await request('THRU',{enabled:false});
    if(playbackState===PT_PLAYBACK_STATE.STOPPED&&!recording){await closeMidiPorts();destroyMidiContext('MIDI THRU disabled; no active session');}
  }
  return midiThru;
}
export const isMidiThruEnabled=()=>midiThru;
let lastThruActivityLogAt=0;
function clearThruTimer(reason='state change'){
  if(thruTimer!==null){
    clearTimeout(thruTimer);thruTimer=null;
    //debug.midi.lifecycle console.log(`[PT MIDI] THRU inactivity timer cancelled — reason: ${reason}`);
  }
}
function scheduleThruTimer(reason='MIDI IN activity',midiData=null){
  clearThruTimer('timer reset');
  if(!midiThru||playbackState!==PT_PLAYBACK_STATE.STOPPED||recording)return;
  const now=performance.now();
  if(midiData&&now-lastThruActivityLogAt>=1000){
    const status=Number(midiData[0]??0).toString(16).padStart(2,'0').toUpperCase();
    //debug.midi.lifecycle console.log(`[PT MIDI] MIDI IN activity — THRU timer reset to ${MIDI_THRU_INACTIVITY_TIMEOUT_SECONDS} s (status 0x${status})`);
    lastThruActivityLogAt=now;
  }else if(!midiData){
    //debug.midi.lifecycle console.log(`[PT MIDI] THRU inactivity timer started/reset — ${MIDI_THRU_INACTIVITY_TIMEOUT_SECONDS} s — reason: ${reason}`);
  }
  thruTimer=setTimeout(async()=>{
    thruTimer=null;
    if(!midiThru||playbackState!==PT_PLAYBACK_STATE.STOPPED||recording)return;
    //debug.midi.lifecycle console.log(`[PT MIDI] THRU inactivity timeout reached — ${MIDI_THRU_INACTIVITY_TIMEOUT_SECONDS} s`);
    await stopAndCloseMidi();autoStopCallback?.();
  },MIDI_THRU_INACTIVITY_TIMEOUT_SECONDS*1000);
}
export async function releaseMidiIfIdle(){if(playbackState!==PT_PLAYBACK_STATE.STOPPED||recording)return;if(midiThru){scheduleThruTimer('session ended');return;}await closeMidiPorts();destroyMidiContext('session ended; no MIDI users remain');}

function sendRaw(data){if(frame)post('SEND',{data});}
function noteKey(channel,pitch){return `${channel}:${pitch}`;}
function cancelPendingNoteOff(note){
  if(note?.noteOffTimeout==null)return;
  clearTimeout(note.noteOffTimeout);
  activeTimeouts.delete(note.noteOffTimeout);
  note.noteOffTimeout=null;
}
function sendNoteOn(channel,pitch,velocity){
  const key=noteKey(channel,pitch),previous=activeNotes.get(key);
  // MIDI 1.0 no identifica instancias de una misma nota dentro de un canal.
  // Una rearticulación de (canal, pitch) debe cerrar primero la instancia anterior
  // y cancelar su NOTE OFF pendiente para que éste no pueda apagar la nueva nota.
  if(previous){
    cancelPendingNoteOff(previous);
    sendRaw([0x80|(channel&15),pitch&127,0]);
    activeNotes.delete(key);
  }
  sendRaw([0x90|(channel&15),pitch&127,velocity&127]);
  activeNotes.set(key,{channel,pitch,noteOffTimeout:null});
}
function sendNoteOff(channel,pitch){sendRaw([0x80|(channel&15),pitch&127,0]);activeNotes.delete(noteKey(channel,pitch));}
function later(callback,delay){const id=setTimeout(()=>{activeTimeouts.delete(id);callback();},Math.max(0,delay));activeTimeouts.add(id);return id;}
function silenceActiveNotes(){for(const id of activeTimeouts)clearTimeout(id);activeTimeouts.clear();for(const n of [...activeNotes.values()])sendNoteOff(n.channel,n.pitch);activeNotes.clear();}
function scheduleNoteOff(e){
  const channel=e.channel??0,key=noteKey(channel,e.pitch);
  let timeoutId=null;
  timeoutId=later(()=>{
    // Un timeout antiguo nunca debe apagar una rearticulación posterior.
    const current=activeNotes.get(key);
    if(!current||current.noteOffTimeout!==timeoutId)return;
    sendNoteOff(channel,e.pitch);
  },e.timeOff-e.timeOn);
  const current=activeNotes.get(key);
  if(current)current.noteOffTimeout=timeoutId;
}
function executeNote(e){sendNoteOn(e.channel??0,e.pitch,e.velocity??80);scheduleNoteOff(e);}
function executeMordent(e){const c=e.channel??0,d=Math.max(0,e.ornamentNoteDuration??0),total=Math.max(0,e.timeOff-e.timeOn),v=e.velocity??80;sendNoteOn(c,e.pitch,v);later(()=>{sendNoteOff(c,e.pitch);sendNoteOn(c,e.alterPitch,v);},Math.min(d,total));later(()=>{sendNoteOff(c,e.alterPitch);sendNoteOn(c,e.pitch,v);},Math.min(2*d,total));later(()=>sendNoteOff(c,e.pitch),total);}
function executeEvent(e){if(e.type===PT_EVENT.METRONOME)executeNote({...e,...metronomeVoice()});else if(e.type===PT_EVENT.NOTE)executeNote(e);else if(e.type===PT_EVENT.MORDENT)executeMordent(e);else if(e.type===PT_EVENT.CONTROL_CHANGE)sendRaw([0xB0|((e.channel??0)&15),e.controller&127,e.value&127]);}
function clearQueueTimer(){if(queueTimer!==null){clearTimeout(queueTimer);queueTimer=null;}}
function finishPlayback(token){if(!playback||token!==playbackToken)return;clearQueueTimer();playbackState=PT_PLAYBACK_STATE.STOPPED;const onEnd=playback.callbacks.onEnd;playback=null;scheduleThruTimer();onEnd?.();}
function pump(token){if(!playback||playbackState!==PT_PLAYBACK_STATE.PLAYING||token!==playbackToken)return;const elapsed=performance.now()-playback.startedAt;playback.callbacks.onClock?.(elapsed);while(playback.index<playback.events.length&&playback.events[playback.index].timeOn<=elapsed){const e=playback.events[playback.index++];playback.callbacks.onEvent?.(e);executeEvent(e);}if(playback.index<playback.events.length)queueTimer=setTimeout(()=>pump(token),5);else{const lastOff=Math.max(0,...playback.events.map(e=>e.timeOff??e.timeOn));queueTimer=setTimeout(()=>finishPlayback(token),Math.max(0,lastOff-elapsed)+5);}}

function isThruActivityMessage(data){
  const [status=0,data1=0]=data??[];
  const command=status&0xf0;
  return command===0x80 || command===0x90 || (command===0xB0 && MIDI_PEDAL_CONTROLLERS.has(data1&127));
}
function recordingNow(){
  const pause = recordingPauseStartedAt===null ? 0 : performance.now()-recordingPauseStartedAt;
  // El origen temporal de la captura es el comienzo musical del pasaje.
  // Durante los ticks de introducción recordingStartedAt está en el futuro,
  // por lo que las anticipaciones del alumno se conservan con tiempo negativo.
  return performance.now()-recordingStartedAt-recordingPausedDuration-pause;
}
function closeCapturedNotes(now=recordingNow()){
  for(const e of capturedOpenNotes.values())if(e.timeOff==null)e.timeOff=now;
  capturedOpenNotes.clear();
}
function handleMidiInput(data){
  try{midiInputObserver?.(data,performance.now());}catch(error){console.error('[MIDI] Observador de escucha activa:',error);}
  if(midiThru&&isThruActivityMessage(data))scheduleThruTimer('note/pedal MIDI IN activity',data);
  if(!recording||recordingPauseStartedAt!==null)return;
  const [status=0,data1=0,data2=0]=data??[];
  const command=status&0xf0,channel=status&15,now=recordingNow();
  if(command===0x90&&data2>0){
    const pitch=data1&127,key=noteKey(channel,pitch),prev=capturedOpenNotes.get(key);
    if(prev)prev.timeOff=now;
    const e={type:PT_EVENT.NOTE,timeOn:now,timeOff:null,channel,pitch,velocity:data2&127};
    capturedEvents.push(e);capturedOpenNotes.set(key,e);
  }else if(command===0x80||(command===0x90&&data2===0)){
    const pitch=data1&127,key=noteKey(channel,pitch),e=capturedOpenNotes.get(key);
    if(e){e.timeOff=now;capturedOpenNotes.delete(key);}
  }else if(command===0xB0&&MIDI_PEDAL_CONTROLLERS.has(data1&127)){
    capturedEvents.push({type:PT_EVENT.CONTROL_CHANGE,time:now,channel,controller:data1&127,value:data2&127});
  }
}
export function startRecording(startTime=performance.now()){
  capturedEvents=[];capturedOpenNotes.clear();recordingStartedAt=startTime;recordingPausedDuration=0;recordingPauseStartedAt=null;recording=true;clearThruTimer('recording started');return startTime;
}
export function pauseRecording(){if(!recording||recordingPauseStartedAt!==null)return false;closeCapturedNotes();recordingPauseStartedAt=performance.now();return true;}
export function resumeRecording(){if(!recording||recordingPauseStartedAt===null)return false;recordingPausedDuration+=performance.now()-recordingPauseStartedAt;recordingPauseStartedAt=null;return true;}
export function stopRecording(){
  if(recording)closeCapturedNotes();recording=false;recordingPauseStartedAt=null;scheduleThruTimer('recording stopped');return getCapturedPerformance();
}
export function getCapturedPerformance(){return {type:'CapturedPerformance',events:capturedEvents.map(e=>({...e}))};}
export const isRecording=()=>recording;

export function play(sequence,callbacks={}){const needsOutput=sequence.some(e=>[PT_EVENT.NOTE,PT_EVENT.METRONOME,PT_EVENT.MORDENT,PT_EVENT.CONTROL_CHANGE].includes(e.type));if(needsOutput&&!selectedOutputId)throw new Error('No hay MIDI OUT seleccionado.');stop();clearThruTimer('playback started');const token=++playbackToken;const startedAt=performance.now();playback={events:[...sequence],index:0,startedAt,pausedAt:0,callbacks:{onStart:callbacks.onStart,onClock:callbacks.onClock,onEvent:callbacks.onEvent,onEnd:callbacks.onEnd}};playbackState=PT_PLAYBACK_STATE.PLAYING;playback.callbacks.onStart?.(startedAt);pump(token);}
export function pause(){if(!playback||playbackState!==PT_PLAYBACK_STATE.PLAYING)return false;playback.pausedAt=performance.now()-playback.startedAt;playbackState=PT_PLAYBACK_STATE.PAUSED;clearQueueTimer();silenceActiveNotes();return true;}
export function resume(){if(!playback||playbackState!==PT_PLAYBACK_STATE.PAUSED)return false;playback.startedAt=performance.now()-playback.pausedAt;playbackState=PT_PLAYBACK_STATE.PLAYING;clearThruTimer('playback resumed');pump(playbackToken);return true;}
export function seek(timeMs=0){if(!playback)return false;const target=Math.max(0,Number(timeMs)||0),wasPlaying=playbackState===PT_PLAYBACK_STATE.PLAYING;clearQueueTimer();silenceActiveNotes();playback.index=playback.events.findIndex(e=>e.timeOn>=target);if(playback.index<0)playback.index=playback.events.length;playback.pausedAt=target;playback.startedAt=performance.now()-target;if(wasPlaying)pump(playbackToken);return true;}
export function stop(){clearQueueTimer();silenceActiveNotes();playbackToken++;playbackState=PT_PLAYBACK_STATE.STOPPED;playback=null;scheduleThruTimer('playback stopped');}
export function panic(){stop();if(frame)for(let ch=0;ch<16;ch++){sendRaw([0xB0|ch,64,0]);sendRaw([0xB0|ch,123,0]);sendRaw([0xB0|ch,120,0]);}}
