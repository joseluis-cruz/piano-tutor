import { MusicXMLParser } from './music/MusicXMLParser.js';
import { createMeasureRecognizer } from './session/pt_recognizer.js';
import { buildReviewEntries } from './session/pt_review.js';
import { createSession, PT_HAND } from './session/pt_session.js';
import { PT_EVENT } from './core/pt_events.js';
import { setMetronomeDrumKit } from './core/pt_metronome.js';
import { consolidatePerformance, consolidateResults, noteErrorKinds } from './session/pt_evaluator.js';
import { initMidi, refreshMidiDevices, getMidiInputs, getMidiOutputs, setInputDevice, setOutputDevice, openSelectedMidiPorts, stopAndCloseMidi, stopMidiSession, setMidiThru, isMidiContextActive, setMidiAutoStopCallback, releaseMidiIfIdle, play, pause, resume, seek, stop, startRecording, stopRecording, pauseRecording, resumeRecording, getCapturedPerformance, isRecording, PT_PLAYBACK_STATE, setMidiInputObserver, sendLiveMetronomeNote } from './midi/pt_midi.js';

const $ = s => document.querySelector(s);
const fileInput=$('#musicxml-file'), downloadMusicXMLButton=$('#download-musicxml'), loadUrlButton=$('#load-url'), urlDialog=$('#url-dialog'), urlForm=$('#url-form'), urlInput=$('#musicxml-url'), urlCancelButton=$('#url-cancel'), output=$('#json-output'), metadataOutput=$('#score-metadata');
const movementInput=$('#movement'), movementLabel=$('#movement-label'), fromInput=$('#from-measure'), toInput=$('#to-measure'), bpmInput=$('#bpm'), introInput=$('#intro'), metronomeInput=$('#metronome'), evaluateDurationInput=$('#evaluate-duration'), evaluateDynamicsInput=$('#evaluate-dynamics'), lessonControls=$('#lesson-controls'), lessonOutput=$('#lesson-output');
const sessionModeInput=$('#session-mode'), loopInput=$('#loop'), playLeftInput=$('#play-left'), playRightInput=$('#play-right'), accompanyLeftInput=$('#accompany-left'), accompanyRightInput=$('#accompany-right'), recordLeftInput=$('#record-left'), recordRightInput=$('#record-right');
const setFromCurrentButton=$('#set-from-current'), setToCurrentButton=$('#set-to-current'), resetMeasureRangeButton=$('#reset-measure-range');
const playButton=$('#play'), restartButton=$('#restart'), previousMeasureButton=$('#previous-measure'), nextMeasureButton=$('#next-measure'), panicButton=$('#panic'), playStatus=$('#play-status'), followScoreInput=$('#follow-score'), workspace=$('.workspace'), positionMeasure=$('#position-measure'), positionBeat=$('#position-beat'), expectedOutput=$('#expected-output'), midiIn=$('#midi-in'), midiOut=$('#midi-out'), refreshMidiButton=$('#refresh-midi'), midiThruInput=$('#midi-thru');
const asideButtons=[...document.querySelectorAll('[data-aside-view]')];
const asideViews={repertoire:$('#repertoire-aside'),lesson:$('#lesson-aside'),results:$('#results-aside'),settings:$('#settings-aside')};
const repertoireStatus=$('#repertoire-status'), repertoirePieces=$('#repertoire-pieces'), repertoireLessons=$('#repertoire-lessons'), repertoirePieceTrigger=$('#repertoire-piece-trigger'), repertoirePieceMenu=$('#repertoire-piece-menu'), repertoireCurrentTitle=$('#repertoire-current-title'), repertoireCurrentMeta=$('#repertoire-current-meta');
const editFeedback=$('#edit-feedback'), activeListeningSwitch=$('#active-listening'), activeMetronomeButton=$('#active-metronome-mode');
const resultsEmpty=$('#results-empty'), resultsContent=$('#results-content'), resultsBars=$('#results-bars'), resultsMeasures=$('#results-measures'), resultsMeasuresHead=$('#results-measures-head');
let sourceXmlText='', xmlText='', movements=[], currentMovementIndex=0, jsonScore=null, lesson=null, currentSession=null, osmd=null, playbackState=PT_PLAYBACK_STATE.STOPPED, lastCursorTick=null, lessonDirty=false;
let editMode=false, selectedNote=null, selectedGraphicalNote=null;
let currentScoreName='partitura.musicxml', scoreModified=false;
let midiStopPromise=Promise.resolve();
let sessionIsRecording=false;
let freeRecordingActive=false;
let restoreSessionAfterFreeRecording=false;
let thruWarningShown=false;
let statusPulseTimer=null;
let conceptualHighlightObserver=null;
let conceptualHighlightFrame=0;
let conceptualHighlightSvg=null;
let evaluatedMeasures=new Map();
let evaluatedNotes=new Map();
let evaluatedMessages=new Map();
let evaluatedUnexpected=[];
let reviewMode=false,reviewEntries=[],reviewIndex=-1,reviewMessage=null;
let activeSessionMetronomeMode='off';
let activeLastMusicalAttackTime=null,activeHeldKeys=new Set(),activeAutoStopping=false;
let showEvaluationMeasureBackgrounds=false;
// ESCUCHA ACTIVA: reloj independiente de las sesiones y sin captura MIDI.
const ACTIVE_TAP_MIN_PITCH=96; // C7 (MIDI)
const ACTIVE_TAP_MAX_DURATION_MS=200;
const ACTIVE_METRONOME_VELOCITY=80;
const ACTIVE_METRONOME_DURATION_MS=90;
const ACTIVE_MIN_BPM=20, ACTIVE_MAX_BPM=300;
let activeListening=false, activeListeningPaused=false, activeListeningTempo=null;
let activeTapPitch=null, activeTapDown=new Map(), activeTapTimes=[];
let activeTapLastOnset=null;
let activeTickTimeout=null, activeNextTickAt=null, activeRemainingToTick=null;
const ACTIVE_METRONOME_MODE=Object.freeze({OFF:'off',FLEXIBLE:'flexible',STRICT:'strict'});
// Pausa basada en PARTITURA (próximo ataque esperado), no en tiempo desde último MIDI IN.
const ACTIVE_PAUSE_GRACE_BEATS=1.35;
const ACTIVE_PAUSE_MIN_GRACE_MS=450;
const ACTIVE_PAUSE_MAX_GRACE_MS=1900;
const ACTIVE_PAUSE_AT_END_BEATS=2;
// Conservar el pulso durante silencios y la primera incertidumbre, sin persecución infinita.
// Margen tras terminar el compás, para tolerar el siguiente ataque tardío.
const ACTIVE_FLEX_END_MEASURE_GRACE_BEATS=0.85;
const ACTIVE_FLEX_END_MEASURE_MIN_GRACE_MS=350;
const ACTIVE_FOLLOW_STEP_MS=45;
const ACTIVE_FLEX_CONFIDENCE=0.76;
function storedMetronomeMode(){
  try { const mode=localStorage.getItem(STORAGE_ACTIVE_METRONOME_MODE); return Object.values(ACTIVE_METRONOME_MODE).includes(mode)?mode:ACTIVE_METRONOME_MODE.OFF; }
  catch { return ACTIVE_METRONOME_MODE.OFF; }
}
function persistMetronomeMode(){try{localStorage.setItem(STORAGE_ACTIVE_METRONOME_MODE,activeMetronomeMode);}catch{}}
let activeMetronomeMode=storedMetronomeMode(),activeLastTickPitch=ACTIVE_TAP_MIN_PITCH;
let activeStrictTempoLocked=false, activeStrictTempoFromTap=false, activeMelodyStarted=false;
// No altera timestamps MIDI: sólo corrige el origen de la referencia musical.
const ACTIVE_START_ANTICIPATION_BEATS=0.20;
let activeFirstMelodyTime=null,activeFirstMelodyTick=null;

let activeFollowAnchor=null,activeFollowTimer=null,activeLastStudentOn=null,activeFollowBpm=null,activeFlexSuspended=true;
let activeExpectedMeasure=null,activeRecognizedTick=null,activeRelocalizing=false,activeLastConfirmedHand=[];
let activeRecognizer=null,activeCapturedEvents=[];
let activeStartingMeasure=null,activeWaitingMeasure=null,activeMeasuredBpm=null;
const activeInitialVisitedMeasures=new Set();
const ACTIVE_WAITING_COLOR='#fff2b7';
const ACTIVE_WAITING_OPACITY=0.25;
// Referencia expandida de TODO el movimiento: nunca depende del rango mutable
// de la lección. Se construye al activar y al reanudar Escucha activa.
let activeFullExpectedPerformance=null;
function prepareFullActiveReference(){
  if(!jsonScore)throw new Error('Carga una partitura antes de activar Escucha activa.');
  const configuration={...lessonFromControls(),fromMeasure:1,toMeasure:jsonScore.measures,
    recordRight:true,recordLeft:true,metronome:false,intro:false};
  activeFullExpectedPerformance=createSession(jsonScore,configuration,{
    ...sessionOptionsFor(configuration),evaluateHand:PT_HAND.BOTH,
    playbackHand:PT_HAND.NONE,metronome:false,intro:false
  }).expectedPerformance;
  initializeActiveRecognizer(Number(fromInput.value)||1);
}
function initializeActiveRecognizer(configuredStart){
  activeRecognizer=createMeasureRecognizer(jsonScore,{
    fullExpectedPerformance:activeFullExpectedPerformance,
    initialMeasure:configuredStart,
    onDebug:(...args)=>console.log('[RECOGNITION]',...args), //debug.midi.recognition
    onRecognized:activeRecognizedMeasure,
    onProgress:activeRecognitionProgress
  });
  console.log('[RECOGNITION] Referencia completa preparada',{
    desde:activeFullExpectedPerformance.fromMeasure,
    hasta:activeFullExpectedPerformance.toMeasure,
    eventos:activeFullExpectedPerformance.events.length
  }); //debug.midi.recognition
}
// Sólo el último intento continuo es evaluable. Los saltos confirmados
// descartan el intento anterior; las pausas naturales no lo cierran.
let activeFragmentStartTime=null,activeFragmentFirstMeasure=null,activeFragmentLastMeasure=null;
let activeFragmentHands=new Set(),activeFragmentConfirmed=false;
let activeFragmentAnchors=[]; // Referencias (tick, tiempo, bpm) confirmadas durante el fragmento.
let activeFlexStopTimer=null,activeFlexStopGeneration=0;
// La suspensión automática sólo puede producirse tras el último pulso del compás.
let activeFlexMeasureGuard=null;
function updateFlexMeasureGuard(anchor){
  if(!jsonScore||!anchor||activeMetronomeMode!=='flexible')return;
  const markers=jsonScore.events.filter(e=>e.type==='startOfMeasure').sort((a,b)=>a.startTick-b.startTick);
  const current=[...markers].reverse().find(m=>m.startTick<=anchor.tick);
  if(!current)return;
  const beats=Number(current.beats)||4,beatType=Number(current.beatType)||4;
  const beatTicks=(jsonScore.ppq||480)*4/beatType;
  const next=markers.find(m=>m.startTick>current.startTick);
  const previous=activeFlexMeasureGuard;
  activeFlexMeasureGuard={measure:current.measure,firstTick:current.startTick,
    lastBeatTick:Math.min(next?.startTick??Infinity,current.startTick+beats*beatTicks)-beatTicks,
    lastBeatEmitted:previous?.measure===current.measure&&previous.lastBeatEmitted===true,
    anchorTick:anchor.tick,anchorTime:anchor.time,bpm:anchor.bpm};
}
function registerFlexBeatEmitted(scheduledTime){
  const guard=activeFlexMeasureGuard;
  if(!guard||!activeListeningTempo||activeMetronomeMode!=='flexible')return;
  const ppq=jsonScore?.ppq||480;
  const performedTick=guard.anchorTick+(scheduledTime-guard.anchorTime)*guard.bpm*ppq/60000;
  if(performedTick>=guard.lastBeatTick-1)guard.lastBeatEmitted=true;
  console.log('[FLEX] Pulso emitido', {compas:guard.measure,tick:Math.round(performedTick),ultimo:guard.lastBeatEmitted}); //debug.midi.recognition
}



const OSMD_CURSOR_NORMAL_COLOR='#55b7df';
const OSMD_CURSOR_EDIT_COLOR='#f2c500';
// Presentación pedagógica: colores temporales, nunca exportados al MusicXML.
const PT_OUTSIDE_LESSON_COLOR='#808080';
const PT_OUTSIDE_LESSON_ALPHA=0.17;
const PT_EVALUATION_MEASURE_ALPHA=0.20;
const PT_ERROR_COLOR=Object.freeze({omitted:'#bb46f6',pitch:'#ff2525',timing:'#168cff',duration:'#1745a8'});
const PT_TIMING_ERROR_FRACTION=0.50;
const PT_DURATION_TOO_SHORT_RATIO=0.55;
const PT_DURATION_TOO_LONG_RATIO=1.80;

const debugEnabled=new URLSearchParams(window.location.search).get('debug')==='true';
const developerPanel=$('.developer-panel');
if(developerPanel) developerPanel.hidden=!debugEnabled;

const STORAGE_MIDI_IN='pianoTutor.midiIn';
const STORAGE_MIDI_OUT='pianoTutor.midiOut';
const STORAGE_DRUM_KIT_METRONOME='pianoTutor.useDrumKitMetronome';
const drumKitMetronomeInput=$('#use-drum-kit-metronome');
try{drumKitMetronomeInput.checked=localStorage.getItem(STORAGE_DRUM_KIT_METRONOME)==='true';}catch{}
setMetronomeDrumKit(drumKitMetronomeInput.checked);
drumKitMetronomeInput.addEventListener('change',()=>{
  setMetronomeDrumKit(drumKitMetronomeInput.checked);
  try{localStorage.setItem(STORAGE_DRUM_KIT_METRONOME,String(drumKitMetronomeInput.checked));}
  catch(error){console.warn('[STORAGE] No se pudo guardar la preferencia de metrónomo:',error);}
});
const STORAGE_LESSON='pianoTutor.lesson.v1';
const STORAGE_ACTIVE_METRONOME_MODE='pt_metronome_mode';
const RECENT_SCORE_DB='pianoTutor';
const RECENT_SCORE_STORE='recentScore';
const RECENT_SCORE_KEY='lastMusicXML';
const STORAGE_LAST_URL='pianoTutor.lastMusicXmlUrl';
const REPERTOIRE_URL='repertoire/repertoire.json';
let repertoire={pieces:[]}, selectedRepertoirePieceId=null;

function scoreMetadata(xml, fallbackName='') {
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const generic=/^(untitled(?: score)?|unknown|sin t[ií]tulo)$/i;
  const clean=value=>(value??'').replace(/\s+/g,' ').trim();
  const candidates=[];
  const add=value=>{const text=clean(value);if(text&&!generic.test(text)&&!candidates.includes(text))candidates.push(text);};
  add(doc.querySelector('work > work-title')?.textContent);
  add(doc.querySelector('movement-title')?.textContent);
  for(const creator of doc.querySelectorAll('identification > creator')) add(creator.textContent);
  for(const credit of doc.querySelectorAll('credit > credit-words')) add(credit.textContent);
  if(!candidates.length) add(fallbackName);
  return candidates.join(' · ') || 'MusicXML cargado';
}
function handSelection(left,right){
  if(left&&right)return PT_HAND.BOTH;
  if(left)return PT_HAND.LEFT;
  if(right)return PT_HAND.RIGHT;
  return PT_HAND.NONE;
}

function firstTempo(xml) {
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const sound=[...doc.querySelectorAll('sound[tempo]')].find(n=>Number(n.getAttribute('tempo'))>0);
  if(sound) return Math.round(Number(sound.getAttribute('tempo')));
  const perMinute=[...doc.querySelectorAll('metronome > per-minute')].find(n=>Number(n.textContent)>0);
  return perMinute ? Math.round(Number(perMinute.textContent)) : 80;
}

function detectMovements(xml){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('MusicXML no válido.');
  const part=doc.querySelector('score-partwise > part');
  if(!part)throw new Error('No se encontró una parte MusicXML score-partwise.');
  const measures=[...part.querySelectorAll(':scope > measure')];
  if(!measures.length)throw new Error('El MusicXML no contiene compases.');
  const starts=[0];
  let maxNumber=Number.parseInt(measures[0].getAttribute('number'),10)||1;
  for(let i=1;i<measures.length;i++){
    const number=Number.parseInt(measures[i].getAttribute('number'),10);
    // Un reinicio a 1 después de haber avanzado más allá de 1 delimita un nuevo movimiento.
    if(number===1&&maxNumber>1){starts.push(i);maxNumber=1;continue;}
    if(Number.isFinite(number))maxNumber=Math.max(maxNumber,number);
  }
  return starts.map((start,index)=>({index,start,end:(starts[index+1]??measures.length)-1}));
}
function movementXml(source,movement){
  const doc=new DOMParser().parseFromString(source,'application/xml');
  for(const part of doc.querySelectorAll('score-partwise > part')){
    const measures=[...part.querySelectorAll(':scope > measure')];
    measures.forEach((measure,index)=>{if(index<movement.start||index>movement.end)measure.remove();});
  }
  return new XMLSerializer().serializeToString(doc);
}
function fillMovementSelect(){
  movementInput.innerHTML='';
  movements.forEach((_,index)=>movementInput.add(new Option(`Movimiento ${index+1}`,String(index))));
  movementInput.value=String(currentMovementIndex);
  movementLabel.hidden=movements.length<=1;
}
function clearStatusPulse(){
  if(statusPulseTimer!==null){clearTimeout(statusPulseTimer);statusPulseTimer=null;}
  playStatus.classList.remove('status-pulse-dim');
}
function setTransportStatus(kind,text){
  clearStatusPulse();
  playStatus.className=`transport-status status-${kind}`;
  playStatus.textContent=text;
}
function pulseTransportStatus(kind,text){
  setTransportStatus(kind,text);
  if(!lesson?.metronome)return;
  const beatMs=60000/(currentSession?.config?.bpm||lesson?.bpm||80)*(4/(currentSession?.config?.beatType||4));
  statusPulseTimer=setTimeout(()=>{
    playStatus.classList.add('status-pulse-dim');
    statusPulseTimer=null;
  },Math.max(1,beatMs/2));
}

function setPlaybackState(state){
  playbackState=state;
  lessonControls.disabled=!jsonScore;
  playButton.disabled=!jsonScore;
  restartButton.disabled=!jsonScore || !currentSession;
  previousMeasureButton.disabled=!jsonScore || !currentSession;
  nextMeasureButton.disabled=!jsonScore || !currentSession;
  if(state===PT_PLAYBACK_STATE.PLAYING){playButton.textContent='⏸ Pausa';setTransportStatus('playing','REPRODUCIENDO');}
  else if(state===PT_PLAYBACK_STATE.PAUSED){playButton.textContent='▶ Continuar';setTransportStatus('paused','PAUSADO');}
  else {playButton.textContent='▶ Iniciar';setTransportStatus('stopped','DETENIDO');}
}
function showIntroStatus(event,label='INTRO'){
  const beatMs=60000/(currentSession?.config?.bpm||lesson?.bpm||80)*(4/(currentSession?.config?.beatType||4));
  const remaining=Math.max(1,Math.ceil(((currentSession?.config?.passageStartTime??0)-event.timeOn)/beatMs));
  pulseTransportStatus('intro',`${label} ${remaining}`);
}
function showActiveSessionStatus({pulse=false}={}){
  const kind=sessionIsRecording?'recording':'playing', text=sessionIsRecording?'GRABANDO':'REPRODUCIENDO';
  if(pulse)pulseTransportStatus(kind,text); else setTransportStatus(kind,text);
}


function lessonOriginTick(){ return jsonScore?.events.find(e=>e.type==='startOfMeasure'&&e.measure===lesson?.fromMeasure)?.startTick ?? 0; }
function measurePositionAtTick(tick){
  const markers=jsonScore?.events.filter(e=>e.type==='startOfMeasure'&&e.startTick<=tick)??[];
  const marker=markers.at(-1); if(!marker)return null;
  const beatTicks=jsonScore.ppq*4/(marker.beatType??4); return {measure:marker.measure,beat:1+(tick-marker.startTick)/beatTicks};
}
function currentMeasure(){ return Number.isFinite(lastCursorTick) ? measurePositionAtTick(lastCursorTick)?.measure ?? null : null; }
function formatBeat(beat){ return Number.isInteger(beat)?String(beat):beat.toLocaleString('es-ES',{maximumFractionDigits:2}); }
function updatePositionLabel(startTick){ const pos=measurePositionAtTick(startTick); positionMeasure.textContent=pos?String(pos.measure):'—'; positionBeat.textContent=pos?formatBeat(pos.beat):'—'; }
function cursorTick(cursor){
  const iterator=cursor?.Iterator??cursor?.iterator;
  const stamp=iterator?.CurrentSourceTimestamp??iterator?.currentSourceTimestamp;
  const real=stamp?.RealValue??stamp?.realValue;
  return Number.isFinite(real)?Math.round(real*4*(jsonScore?.ppq||480)):null;
}
function osmdTick(){ return cursorTick(osmd?.cursor); }
function updateCurrentMeasureButtons(){const enabled=Number.isFinite(lastCursorTick)&&Boolean(jsonScore);setFromCurrentButton.disabled=!enabled;setToCurrentButton.disabled=!enabled;}
function resetScoreCursor(show=false){ if(!osmd?.cursor)return; osmd.cursor.reset(); lastCursorTick=null; updateCurrentMeasureButtons(); setCursorAppearance(editMode); if(show)osmd.cursor.show(); else osmd.cursor.hide(); setCursorAppearance(editMode); }
function configureWorkspace(){
  const transportHeight=$('.transport-bar')?.getBoundingClientRect().height ?? 90;
  document.documentElement.style.setProperty('--transport-height',`${Math.ceil(transportHeight)}px`);
}
function configureScoreFollowing(){
  configureWorkspace();
  if(!osmd)return;
  osmd.setOptions({followCursor:followScoreInput.checked});
  if(osmd.cursor) osmd.cursor.ScrollPosition='center';
}
function refreshScoreLayout(){
  if(!osmd)return;
  const tick=lastCursorTick;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    try{
      osmd.render();
      renderMeasureHighlights();
      observeMeasureHighlights();
      resetScoreCursor(false);
      if(Number.isFinite(tick)) moveScoreCursor(tick,true); else if(jsonScore) showPassageStart();
      if(activeListening)keepActiveCursorAboveHighlights();
    }catch(error){console.error('[OSMD] No se pudo reajustar la partitura:',error);}
  }));
}
function setAsideView(view){
  const normalized=view in asideViews?view:'hidden';
  const wasClosed=workspace.classList.contains('settings-closed');
  const willClose=normalized==='hidden';
  workspace.classList.toggle('settings-closed',willClose);
  for(const [name,aside] of Object.entries(asideViews)) aside.hidden=name!==normalized;
  for(const button of asideButtons){
    const selected=button.dataset.asideView===normalized;
    button.classList.toggle('selected',selected);
    button.setAttribute('aria-pressed',String(selected));
  }
  // Sólo cambia el ancho disponible para OSMD al abrir/cerrar la columna lateral.
  if(wasClosed!==willClose)refreshScoreLayout();
}
function moveScoreCursor(startTick,allowOutsideLesson=false){
  if(!osmd?.cursor||!Number.isFinite(startTick)||(!allowOutsideLesson&&startTick<lessonOriginTick()))return;
  const target=Math.max(0,startTick),cursor=osmd.cursor;
  // Utilizamos el propio timestamp del iterador, no el tick virtual del
  // usuario, para determinar si realmente se ha desplazado el cursor SVG.
  let current=osmdTick(),guard=0;
  if(current===null||current>target){cursor.reset();current=osmdTick();}
  while(current!==null&&current<target&&!cursor.Iterator?.EndReached&&guard++<10000){
    cursor.next();const next=osmdTick();
    if(next===current)break;
    current=next;
  }
  // Incluso con diferentes APIs de OSMD la UI conserva el tick real reconocido.
  lastCursorTick=startTick;
  updateCurrentMeasureButtons();updatePositionLabel(startTick);
  setCursorAppearance(editMode);
  cursor.show();
  if(activeListening)keepActiveCursorAboveHighlights();
}
function passageEndTick(){
  const next=measureStartTick((lesson?.toMeasure??0)+1);
  if(Number.isFinite(next))return next;
  return Math.max(lessonOriginTick(),...(jsonScore?.events.filter(e=>e.type==='note'&&e.measure<=lesson?.toMeasure).map(e=>e.endTick)??[]));
}
function setCursorAppearance(editing){
  if(!osmd?.cursor)return;
  const options=osmd.cursor.CursorOptions;
  if(options){ options.color=editing?OSMD_CURSOR_EDIT_COLOR:OSMD_CURSOR_NORMAL_COLOR; options.alpha=editing?0.34:0.32; }
  try{ osmd.cursor.update(); }catch{}
}
function clearSelectedGraphicalNote(){
  // No alterar colores: pueden proceder de una evaluación anterior.
  selectedGraphicalNote=null;
}
function refreshEditFeedback(){
  if(!editFeedback)return;
  if(reviewMode){
    editFeedback.replaceChildren();
    for(const message of (reviewMessage??'REVISIÓN · Utiliza ← y → para recorrer los errores.').split('\n')){
      const line=document.createElement('div');line.textContent=message;editFeedback.append(line);
    }
    editFeedback.classList.toggle('is-clear',reviewEntries.length===0);editFeedback.hidden=false;return;
  }
  if(!editMode||!selectedNote){editFeedback.hidden=true;editFeedback.replaceChildren();return;}
  const candidates=notesAtTick(selectedNote.startTick).sort((a,b)=>a.staff-b.staff||a.pitch-b.pitch);
  const lines=[];let hasErrors=false;
  const byStaff=new Map();
  for(const note of candidates){if(!byStaff.has(note.staff))byStaff.set(note.staff,[]);byStaff.get(note.staff).push(note);}
  for(const [staff,notes] of byStaff){
    const hand=staff===1?'Mano derecha':staff===2?'Mano izquierda':`Pentagrama ${staff}`;
    const names=notes.map(n=>pitchName(n.pitch)).join('+');
    const messages=notes.flatMap(note=>(evaluatedMessages.get(expectedSourceKey(note))??[]).map(msg=>({note,msg})));
    if(!messages.length){lines.push(`${hand} - ${names}`);continue;}
    hasErrors=true;
    const prefix=`${hand} - ${names}`;
    lines.push(`${prefix}: ${messages.map(({msg})=>msg).join(' · ')}`);
  }
  editFeedback.replaceChildren();
  for(const message of lines){const line=document.createElement('div');line.textContent=message;editFeedback.append(line);}
  editFeedback.classList.toggle('is-clear',!hasErrors);
  editFeedback.hidden=false;
}
function leaveEditMode(){
  clearSelectedGraphicalNote(); selectedNote=null; editMode=false; reviewMode=false;reviewIndex=-1;setCursorAppearance(false);refreshEditFeedback();
}
function graphicalPitch(g){
  const n=g?.sourceNote; const half=n?.halfTone ?? n?.HalfTone;
  return Number.isFinite(half)?half+12:null;
}
function graphicalY(g){
  const box=g?.PositionAndShape ?? g?.positionAndShape;
  const p=box?.AbsolutePosition ?? box?.absolutePosition ?? box?.RelativePosition ?? box?.relativePosition;
  return Number(p?.y ?? p?.Y ?? 0);
}
function highlightSelectedNote(){
  // El modo edición se identifica por el cursor amarillo; no colorea notas.
  clearSelectedGraphicalNote();
  refreshEditFeedback();
}
function notesAtTick(tick){
  return (jsonScore?.events??[]).filter(e=>e.type==='note'&&e.startTick===tick&&e.measure>=lesson.fromMeasure&&e.measure<=lesson.toMeasure);
}
function distinctNoteTicks(){
  return [...new Set((jsonScore?.events??[]).filter(e=>e.type==='note'&&e.measure>=lesson.fromMeasure&&e.measure<=lesson.toMeasure).map(e=>e.startTick))].sort((a,b)=>a-b);
}
function selectNoteAtCurrentTick(preferredStaff=null,cycle=false){
  const tick=lastCursorTick??lessonOriginTick();
  let candidates=notesAtTick(tick);
  if(preferredStaff)candidates=candidates.filter(n=>n.staff===preferredStaff);
  if(!candidates.length)return false;
  candidates.sort((a,b)=>b.pitch-a.pitch || String(a.voice).localeCompare(String(b.voice)));
  let index=0;
  if(cycle&&selectedNote&&selectedNote.startTick===tick&&selectedNote.staff===preferredStaff){
    const old=candidates.indexOf(selectedNote); index=old>=0?(old+1)%candidates.length:0;
  }
  selectedNote=candidates[index]; editMode=true; setCursorAppearance(true); highlightSelectedNote(); return true;
}
// Las entradas de revisión constituyen una lista de eventos, no un índice de notas
// del iterador OSMD. Los ataques inesperados NO existen como notas en OSMD.
function updateSelectedUnexpectedMarker(){
  for(const circle of document.querySelectorAll('[data-pt-unexpected-index]')){
    const selected=reviewMode&&reviewEntries[reviewIndex]?.unexpected&&
      Number(circle.getAttribute('data-pt-unexpected-index'))===reviewEntries[reviewIndex].markerIndex;
    circle.setAttribute('r',selected?'7':'4.5');
    circle.setAttribute('stroke',selected?'#86121b':'#fff');
    circle.setAttribute('stroke-width',selected?'2.5':'1');
  }
}
function enterReviewAtAdjacentError(direction){
  if(!reviewEntries.length){reviewMode=true;editMode=false;reviewMessage='REVISIÓN · No se han detectado errores en el pasaje evaluado.';refreshEditFeedback();return false;}
  // Tras seleccionar el primer error, navegar por índice EXCLUSIVAMENTE:
  // nunca sumar puntos rojos a los pasos del cursor de partitura.
  const current=lastCursorTick??lessonOriginTick();
  const index=reviewIndex>=0?reviewIndex+(direction>0?1:-1):
    direction>0?Math.max(0,reviewEntries.findIndex(e=>e.tick>=current)):
      Math.max(0,reviewEntries.findLastIndex(e=>e.tick<=current));
  if(index<0||index>=reviewEntries.length)return false;
  reviewIndex=index;const target=reviewEntries[index];
  editMode=false;reviewMode=true;
  if(target.unexpected){
    // Nunca desplazar el iterador nativo de OSMD hasta un tick sintético:
    // hacerlo sitúa el cursor en la nota siguiente y desincroniza la navegación.
    osmd?.cursor?.hide();
  }else{
    moveScoreCursor(target.tick,true);
  }
  reviewMessage=target.message;
  updateSelectedUnexpectedMarker();setCursorAppearance(false);refreshEditFeedback();return true;
}
function enterEditAtAdjacentNote(direction){
  if(showEvaluationMeasureBackgrounds)return enterReviewAtAdjacentError(direction);
  if(!jsonScore||!lesson)return false;
  const ticks=distinctNoteTicks(); if(!ticks.length)return false;
  const current=Number.isFinite(lastCursorTick)?lastCursorTick:lessonOriginTick();
  let target=direction>0?ticks.find(t=>t>current):[...ticks].reverse().find(t=>t<current);
  if(!Number.isFinite(target))return false;
  const preferredStaff=selectedNote?.staff??null;
  moveScoreCursor(target); editMode=true; setCursorAppearance(true);
  if(preferredStaff&&!selectNoteAtCurrentTick(preferredStaff,false))selectNoteAtCurrentTick(null,false); else if(!preferredStaff)selectNoteAtCurrentTick(null,false);
  return true;
}
function enterEditOnStaff(staff){
  if(showEvaluationMeasureBackgrounds)return false;
  if(!jsonScore||!lesson)return false;
  const tick=lastCursorTick??lessonOriginTick();
  const cycling=editMode&&selectedNote?.staff===staff&&selectedNote?.startTick===tick;
  if(selectNoteAtCurrentTick(staff,cycling))return true;
  // Acceso directo arriba/abajo: si el cursor está entre ataques, buscamos el
  // primer ataque de ese pentagrama en la posición musical actual o posterior.
  const candidate=(jsonScore.events??[]).filter(e=>e.type==='note'&&e.staff===staff&&e.startTick>=tick&&e.measure>=lesson.fromMeasure&&e.measure<=lesson.toMeasure).sort((a,b)=>a.startTick-b.startTick||b.pitch-a.pitch)[0];
  if(!candidate)return false;
  moveScoreCursor(candidate.startTick); return selectNoteAtCurrentTick(staff,false);
}

function selectedNoteIdentity(note=selectedNote){
  return note ? {sourceMeasureIndex:note.sourceMeasureIndex,sourceNoteIndex:note.sourceNoteIndex,staff:note.staff,pitch:note.pitch,startTick:note.startTick} : null;
}
function findCanonicalNote(identity){
  if(!identity)return null;
  return (jsonScore?.events??[]).find(e=>e.type==='note'&&e.sourceMeasureIndex===identity.sourceMeasureIndex&&e.sourceNoteIndex===identity.sourceNoteIndex)??null;
}
function noteElementInDocument(doc,measureIndex,noteIndex){
  const part=doc.querySelector('score-partwise > part'); if(!part)return null;
  const measure=[...part.querySelectorAll(':scope > measure')][measureIndex]; if(!measure)return null;
  return [...measure.children].filter(n=>n.tagName==='note')[noteIndex]??null;
}
function ensureChild(parent,name){
  let child=[...parent.children].find(n=>n.tagName===name);
  if(!child){child=parent.ownerDocument.createElement(name);parent.appendChild(child);}
  return child;
}
function cleanupEmpty(element){ if(element&&element.children.length===0&&!element.textContent.trim())element.remove(); }
function mutateSelectedNoteInXml(mutator){
  const identity=selectedNoteIdentity(); if(!identity||!sourceXmlText)return false;
  const doc=new DOMParser().parseFromString(sourceXmlText,'application/xml');
  const absoluteMeasure=(movements[currentMovementIndex]?.start??0)+identity.sourceMeasureIndex;
  const node=noteElementInDocument(doc,absoluteMeasure,identity.sourceNoteIndex);
  if(!node)return false;
  mutator(node); sourceXmlText=new XMLSerializer().serializeToString(doc); return true;
}
function fingeringValuesOnNode(node){
  return [...node.querySelectorAll(':scope > notations > technical > fingering')]
    .map(n=>Number(n.textContent?.trim())).filter(n=>Number.isInteger(n)&&n>=1&&n<=5);
}
function setFingeringsOnNode(node,values){
  let notations=[...node.children].find(n=>n.tagName==='notations');
  let technical=notations&&[...notations.children].find(n=>n.tagName==='technical');
  if(technical)[...technical.children].filter(n=>n.tagName==='fingering').forEach(n=>n.remove());
  if(values.length){
    notations??=ensureChild(node,'notations'); technical??=ensureChild(notations,'technical');
    for(const value of values){
      const fingering=node.ownerDocument.createElement('fingering'); fingering.textContent=String(value); technical.appendChild(fingering);
    }
  }
  cleanupEmpty(technical); cleanupEmpty(notations);
}
function selectedChordNotes(){
  if(!selectedNote)return [];
  return notesAtTick(selectedNote.startTick).filter(n=>n.staff===selectedNote.staff&&String(n.voice)===String(selectedNote.voice));
}
function markScoreModified(){
  scoreModified=true;
  if(downloadMusicXMLButton)downloadMusicXMLButton.disabled=false;
}
function selectedGroupXmlNodes(doc,identity=selectedNoteIdentity()){
  if(!identity)return [];
  const absoluteMeasure=(movements[currentMovementIndex]?.start??0)+identity.sourceMeasureIndex;
  return selectedChordNotes().map(n=>noteElementInDocument(doc,absoluteMeasure,n.sourceNoteIndex)).filter(Boolean);
}
function mordentKindOnNode(node){
  if(node.querySelector(':scope > notations > ornaments > inverted-mordent'))return 'inverted';
  if(node.querySelector(':scope > notations > ornaments > mordent'))return 'mordent';
  return null;
}
function mutateSelectedGroupFingerings(toggleNumber){
  const identity=selectedNoteIdentity(); if(!identity||!sourceXmlText)return false;
  const doc=new DOMParser().parseFromString(sourceXmlText,'application/xml');
  const absoluteMeasure=(movements[currentMovementIndex]?.start??0)+identity.sourceMeasureIndex;
  const group=selectedChordNotes();
  const nodes=group.map(n=>noteElementInDocument(doc,absoluteMeasure,n.sourceNoteIndex)).filter(Boolean);
  if(!nodes.length)return false;
  // El conjunto de digitaciones pertenece a la posición/acorde seleccionado. Se conserva
  // el orden de entrada; no imponemos un máximo ligado al número de cabezas.
  const values=[];
  for(const node of nodes) for(const value of fingeringValuesOnNode(node)) if(!values.includes(value))values.push(value);
  if(toggleNumber===6) values.length=0;
  else { const i=values.indexOf(toggleNumber); if(i>=0)values.splice(i,1); else values.push(toggleNumber); }
  // MusicXML admite varios <fingering> dentro de <technical>. Los concentramos en la
  // nota ancla del grupo para no inventar una correspondencia dedo↔cabeza que el usuario
  // no ha especificado; OSMD los representa como digitaciones del ataque/acorde.
  nodes.forEach((node,i)=>setFingeringsOnNode(node,i===0?values:[]));
  sourceXmlText=new XMLSerializer().serializeToString(doc);
  markScoreModified();
  return true;
}
function setMordentOnNode(node,kind){
  let notations=[...node.children].find(n=>n.tagName==='notations');
  let ornaments=notations&&[...notations.children].find(n=>n.tagName==='ornaments');
  if(ornaments){
    [...ornaments.children].filter(n=>n.tagName==='mordent'||n.tagName==='inverted-mordent').forEach(n=>n.remove());
    if(kind==null&&!ornaments.querySelector('mordent,inverted-mordent')) [...ornaments.children].filter(n=>n.tagName==='accidental-mark').forEach(n=>n.remove());
  }
  if(kind){
    notations??=ensureChild(node,'notations'); ornaments??=ensureChild(notations,'ornaments');
    ornaments.appendChild(node.ownerDocument.createElement(kind==='inverted'?'inverted-mordent':'mordent'));
  }
  cleanupEmpty(ornaments); cleanupEmpty(notations);
}
async function persistEditedSource(){
  const recent=await getRecentScore();
  if(recent)await saveRecentScore(recent.name||'',sourceXmlText);
}
async function rerenderAfterNoteEdit(identity){
  const viewport=$('#score-viewport');
  const oldScrollTop=viewport?.scrollTop??0, oldScrollLeft=viewport?.scrollLeft??0;
  evaluatedNotes.clear();evaluatedMeasures.clear();evaluatedMessages.clear();evaluatedUnexpected=[];reviewEntries=[];reviewMode=false;showEvaluationMeasureBackgrounds=false;refreshEditFeedback();
  xmlText=movementXml(sourceXmlText,movements[currentMovementIndex]);
  buildCanonical(); currentSession=null; lessonDirty=true;
  await renderScore(xmlText);
  // Una edición no es navegación: restauramos la selección sin que OSMD anime el foco.
  try{osmd?.setOptions?.({followCursor:false});}catch{}
  selectedNote=findCanonicalNote(identity);
  if(!selectedNote){leaveEditMode();showPassageStart();configureScoreFollowing();return;}
  moveScoreCursor(selectedNote.startTick); editMode=true; setCursorAppearance(true); highlightSelectedNote();
  if(viewport){
    const previousBehavior=viewport.style.scrollBehavior;
    viewport.style.scrollBehavior='auto';
    viewport.scrollTop=oldScrollTop; viewport.scrollLeft=oldScrollLeft;
    requestAnimationFrame(()=>{viewport.scrollTop=oldScrollTop;viewport.scrollLeft=oldScrollLeft;viewport.style.scrollBehavior=previousBehavior;});
  }
  configureScoreFollowing();
  await persistEditedSource();
}
async function editSelectedFingering(number){
  if(!editMode||!selectedNote)return;
  const identity=selectedNoteIdentity();
  if(mutateSelectedGroupFingerings(number))await rerenderAfterNoteEdit(identity);
}
async function cycleSelectedMordent(){
  if(!editMode||!selectedNote)return;
  const identity=selectedNoteIdentity();
  const doc=new DOMParser().parseFromString(sourceXmlText,'application/xml');
  const nodes=selectedGroupXmlNodes(doc,identity);
  if(!nodes.length)return;
  const current=nodes.map(mordentKindOnNode).find(Boolean)??null;
  const next=current==null?'mordent':current==='mordent'?'inverted':null;
  // El mordente pertenece al ataque/grupo seleccionado: limpiamos todas las notas
  // del acorde antes de escribir, como máximo, un único ornamento en la nota ancla.
  nodes.forEach(node=>setMordentOnNode(node,null));
  if(next)setMordentOnNode(nodes[0],next);
  sourceXmlText=new XMLSerializer().serializeToString(doc);
  markScoreModified();
  await rerenderAfterNoteEdit(identity);
}


function showPassageStart(){ const tick=lessonOriginTick(); moveScoreCursor(tick); }
function isRecordingLesson(targetLesson=lesson){return targetLesson?.sessionMode!=='listen'&&(Boolean(targetLesson?.recordLeft)||Boolean(targetLesson?.recordRight));}
function sessionOptionsFor(targetLesson=lesson){
  const recording=isRecordingLesson(targetLesson);
  const useMetronome=Boolean(targetLesson?.metronome);
  return {
    outputChannel:0,
    // En grabación, usar metrónomo fuerza una intro. Sin metrónomo, manda el checkbox de intro.
    intro:recording ? (useMetronome||Boolean(targetLesson?.intro)) : Boolean(targetLesson?.intro),
    metronome:useMetronome,
    // En grabación sólo suena automáticamente el acompañamiento; en escucha, las manos de Reproducir.
    playbackHand:recording
      ? (useMetronome ? handSelection(Boolean(targetLesson?.accompanyLeft),Boolean(targetLesson?.accompanyRight)) : PT_HAND.NONE)
      : handSelection(Boolean(targetLesson?.playLeft),Boolean(targetLesson?.playRight)),
    evaluateHand:handSelection(Boolean(targetLesson?.recordLeft),Boolean(targetLesson?.recordRight))
  };
}
function sessionOptions(){return sessionOptionsFor(lesson);}
function rebuildSession(){
  currentSession=createSession(jsonScore,lesson,sessionOptions());
  expectedOutput.textContent=JSON.stringify(currentSession.expectedPerformance,null,2);
  console.log('PlaybackSequence:',currentSession.playbackSequence);
  console.log('[PT PERFORMANCE] ExpectedPerformance',currentSession.expectedPerformance); //debug.eval.performance
}
// Escala visual provisional de cumplimiento: <=50 % rojo; de 50 a 100 %
// recorre de forma continua rojo → naranja → amarillo → verde.
const RESULT_COLOR_RED_LIMIT = 50;
const RESULT_COLOR_MAX = 100;
function complianceColor(value,lightness=46){
  if(!Number.isFinite(value))return null;
  const v=Math.max(0,Math.min(RESULT_COLOR_MAX,value));
  const hue=v<=RESULT_COLOR_RED_LIMIT?0:120*(v-RESULT_COLOR_RED_LIMIT)/(RESULT_COLOR_MAX-RESULT_COLOR_RED_LIMIT);
  return `hsl(${hue} 78% ${lightness}%)`;
}
function formatPercent(value){return Number.isFinite(value)?`${Math.round(value)} %`:'—';}
function renderResults(results){
  if(!results)return;
  resultsEmpty.hidden=true;resultsContent.hidden=false;resultsBars.innerHTML='';resultsMeasures.innerHTML='';
  const evaluation=results.evaluation??{};
  const metrics=[
    ['Notas','notesCompliance',true],['Tono','pitchCompliance',evaluation.pitch!==false],
    ['Tempo','timingCompliance',Boolean(evaluation.timing)],['Duración','durationCompliance',Boolean(evaluation.duration)],
    // Dinámica queda ya reservada en la presentación. Hasta que exista una
    // métrica pedagógica real mostramos —, nunca una puntuación inventada.
    ['Dinámica','velocityCompliance',Boolean(evaluation.dynamics)]
  ].filter(([,key,enabled])=>enabled&&(key==='velocityCompliance'||Number.isFinite(results.percentages?.[key])));
  for(const [label,key] of metrics){
    const value=results.percentages[key];
    const row=document.createElement('div');row.className='result-bar-row';
    const safe=Number.isFinite(value)?Math.max(0,Math.min(100,value)):0;
    const color=complianceColor(value);
    row.innerHTML=`<span class="result-bar-label">${label}</span><span class="result-bar-track"><span class="result-bar-fill" style="width:${safe}%;${color?`background:${color}`:''}"></span></span><span class="result-bar-value">${formatPercent(value)}</span>`;
    resultsBars.append(row);
  }
  resultsMeasuresHead.innerHTML='<th>Compás</th>';
  for(const [label] of metrics){const th=document.createElement('th');th.className='result-metric-column';th.textContent=label;resultsMeasuresHead.append(th);}
  for(const item of results.byMeasure??[]){
    const tr=document.createElement('tr');tr.className='result-measure-row';tr.tabIndex=0;tr.title=`Ir al compás ${item.measure}`;
    const first=document.createElement('td');first.className='result-measure-cell';
    const number=document.createElement('span');number.className='result-measure-number';number.textContent=String(item.measure);
    const dot=document.createElement('span');dot.className='result-measure-dot';dot.setAttribute('aria-hidden','true');
    const overall=Number.isFinite(item.compliance)?item.compliance:null;if(overall!==null)dot.style.background=complianceColor(overall);
    const startButton=document.createElement('button');startButton.type='button';startButton.className='result-measure-action';startButton.textContent='|<';startButton.title=`Fijar compás ${item.measure} como inicio`;startButton.setAttribute('aria-label',startButton.title);
    const endButton=document.createElement('button');endButton.type='button';endButton.className='result-measure-action';endButton.textContent='>|';endButton.title=`Fijar compás ${item.measure} como final`;endButton.setAttribute('aria-label',endButton.title);
    const setBoundary=(input)=>{const {min,max}=measureBoundsFor(input);input.value=Math.max(min,Math.min(max,item.measure));syncMeasureInputBounds();markLessonDirty();};
    startButton.addEventListener('click',event=>{event.stopPropagation();setBoundary(fromInput);});
    endButton.addEventListener('click',event=>{event.stopPropagation();setBoundary(toInput);});
    first.append(number,dot,startButton,endButton);tr.append(first);
    for(const [,key] of metrics){
      const value=item.percentages?.[key];const td=document.createElement('td');td.className='result-cell result-metric-column';td.textContent=formatPercent(value);
      const color=complianceColor(value,86);if(color)td.style.background=color;else td.classList.add('result-na');tr.append(td);
    }
    const goToMeasure=()=>{const tick=measureStartTick(item.measure);if(Number.isFinite(tick))moveScoreCursor(tick,true);};
    tr.addEventListener('click',goToMeasure);
    tr.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();goToMeasure();}});
    resultsMeasures.append(tr);
  }
  setAsideView('results');
}
function logCapturedPerformance(captured=getCapturedPerformance(),{renderEvaluation=lesson?.sessionMode==='evaluate'}={}){
  console.log('[PT PERFORMANCE] CapturedPerformance',captured); //debug.eval.performance
  if(currentSession?.expectedPerformance){
    const consolidated=consolidatePerformance(currentSession.expectedPerformance,captured);
    console.log('[PT PERFORMANCE] ConsolidatedPerformance',consolidated); //debug.eval.performance
    const results=consolidateResults(consolidated);
    console.log('[PT PERFORMANCE] ConsolidatedResults',results); //debug.eval.performance
    if(renderEvaluation){renderResults(results);updateEvaluationPresentation(consolidated,results);}
  }
  return captured;
}
function updateSessionModeButtons(){
  for(const button of document.querySelectorAll('[data-session-mode]')) button.classList.toggle('selected',button.dataset.sessionMode===sessionModeInput.value);
}
function updateLoopButton(){ loopInput.classList.toggle('selected',loopInput.getAttribute('aria-pressed')==='true'); }
function setLoopControl(value){ loopInput.setAttribute('aria-pressed',String(Boolean(value))); updateLoopButton(); }
function updateAccompanyControls(selectNewlyEnabled=false){
  const leftWasDisabled=accompanyLeftInput.disabled;
  const rightWasDisabled=accompanyRightInput.disabled;
  const recordingRequested=sessionModeInput.value!=='listen'&&(recordLeftInput.checked||recordRightInput.checked);
  const noMetronomeRecording=recordingRequested&&!metronomeInput.checked;
  const rightOnly=recordRightInput.checked&&!recordLeftInput.checked;
  const leftOnly=recordLeftInput.checked&&!recordRightInput.checked;
  accompanyLeftInput.disabled=noMetronomeRecording||!rightOnly;
  accompanyRightInput.disabled=noMetronomeRecording||!leftOnly;
  if(accompanyLeftInput.disabled) accompanyLeftInput.checked=false;
  else if(selectNewlyEnabled&&leftWasDisabled) accompanyLeftInput.checked=true;
  if(accompanyRightInput.disabled) accompanyRightInput.checked=false;
  else if(selectNewlyEnabled&&rightWasDisabled) accompanyRightInput.checked=true;
}
function markLessonDirty(){
  if(!jsonScore)return;
  renderMeasureHighlights();
  lessonDirty=true;
  if(playbackState!==PT_PLAYBACK_STATE.STOPPED){
    midiStopPromise=stopAndCloseMidi().then(()=>{midiThruInput.checked=false;updateMidiControls();}).catch(error=>console.warn('[MIDI] No se pudo detener MIDI:',error));
    setPlaybackState(PT_PLAYBACK_STATE.STOPPED);
  }
}
function updateLessonUI(){
  movementInput.value=String(currentMovementIndex);
  fromInput.value=lesson.fromMeasure; toInput.value=lesson.toMeasure; syncMeasureInputBounds(); bpmInput.value=lesson.bpm;
  introInput.checked=Boolean(lesson.intro); metronomeInput.checked=Boolean(lesson.metronome); evaluateDurationInput.checked=Boolean(lesson.evaluateDuration); evaluateDynamicsInput.checked=Boolean(lesson.evaluateDynamics);
  sessionModeInput.value=lesson.sessionMode??'listen'; updateSessionModeButtons(); setLoopControl(Boolean(lesson.loop)); playLeftInput.checked=Boolean(lesson.playLeft); playRightInput.checked=Boolean(lesson.playRight); recordLeftInput.checked=Boolean(lesson.recordLeft); recordRightInput.checked=Boolean(lesson.recordRight); accompanyLeftInput.checked=Boolean(lesson.accompanyLeft); accompanyRightInput.checked=Boolean(lesson.accompanyRight); updateAccompanyControls();
  lessonOutput.textContent=JSON.stringify(lesson,null,2); if(jsonScore) rebuildSession();
}
function validateLesson(candidate){
  if(!Number.isInteger(candidate.fromMeasure)||!Number.isInteger(candidate.toMeasure)) throw new Error('Los compases deben ser enteros.');
  if(candidate.fromMeasure<1||candidate.toMeasure>jsonScore.measures||candidate.fromMeasure>candidate.toMeasure) throw new Error(`Rango válido: 1–${jsonScore.measures}.`);
  if(!Number.isFinite(candidate.bpm)||candidate.bpm<=0) throw new Error('El BPM debe ser mayor que 0.');
}
function lessonFromControls(){ updateAccompanyControls(); return {movement:currentMovementIndex+1,fromMeasure:Number(fromInput.value),toMeasure:Number(toInput.value),bpm:Number(bpmInput.value),intro:introInput.checked,metronome:metronomeInput.checked,evaluateDuration:evaluateDurationInput.checked,evaluateDynamics:evaluateDynamicsInput.checked,sessionMode:sessionModeInput.value,loop:loopInput.getAttribute('aria-pressed')==='true',playLeft:playLeftInput.checked,playRight:playRightInput.checked,accompanyLeft:accompanyLeftInput.checked,accompanyRight:accompanyRightInput.checked,recordLeft:recordLeftInput.checked,recordRight:recordRightInput.checked}; }
function saveLessonPreference(value){
  try{
    const previous=storedLessonPreference()??{};
    const movement=Number(value.movement)||currentMovementIndex+1;
    const movementsSaved={...(previous.movements??{}),[movement]:{fromMeasure:value.fromMeasure,toMeasure:value.toMeasure,bpm:value.bpm}};
    const {fromMeasure,toMeasure,bpm,...common}=value;
    localStorage.setItem(STORAGE_LESSON,JSON.stringify({...common,movement,movements:movementsSaved}));
  }catch(error){console.warn('[STORAGE] No se pudo guardar la configuración de la lección:',error);}
}
function storedLessonPreference(){try{return JSON.parse(localStorage.getItem(STORAGE_LESSON)||'null');}catch{return null;}}
function initialLessonForScore(){
  const movement=currentMovementIndex+1;
  const defaults={movement,fromMeasure:1,toMeasure:jsonScore.measures,bpm:firstTempo(xmlText),intro:false,metronome:false,evaluateDuration:true,evaluateDynamics:true,sessionMode:'listen',loop:false,playLeft:true,playRight:true,recordLeft:false,recordRight:false,accompanyLeft:false,accompanyRight:false};
  const saved=storedLessonPreference(); if(!saved||typeof saved!=='object')return defaults;
  // Compatibilidad con la configuración plana de v0.35: sólo se hereda para el movimiento 1.
  const legacyMovement=(movement===1&&!saved.movements)?{fromMeasure:saved.fromMeasure,toMeasure:saved.toMeasure,bpm:saved.bpm}:null;
  const movementSaved=saved.movements?.[movement]??legacyMovement;
  const from=Math.max(1,Math.min(jsonScore.measures,Number(movementSaved?.fromMeasure)||1));
  const to=Math.max(from,Math.min(jsonScore.measures,Number(movementSaved?.toMeasure)||jsonScore.measures));
  const mode=['listen','practice','evaluate'].includes(saved.sessionMode)?saved.sessionMode:defaults.sessionMode;
  const {movements:ignoredMovements,fromMeasure:ignoredFrom,toMeasure:ignoredTo,bpm:ignoredBpm,...savedCommon}=saved;
  return {...defaults,...savedCommon,movement,fromMeasure:from,toMeasure:to,bpm:Number(movementSaved?.bpm)>0?Number(movementSaved.bpm):defaults.bpm,sessionMode:mode,loop:Boolean(saved.loop),intro:Boolean(saved.intro),metronome:Boolean(saved.metronome),evaluateDuration:saved.evaluateDuration==null?defaults.evaluateDuration:Boolean(saved.evaluateDuration),evaluateDynamics:saved.evaluateDynamics==null?defaults.evaluateDynamics:Boolean(saved.evaluateDynamics),playLeft:saved.playLeft==null?defaults.playLeft:Boolean(saved.playLeft),playRight:saved.playRight==null?defaults.playRight:Boolean(saved.playRight),recordLeft:Boolean(saved.recordLeft),recordRight:Boolean(saved.recordRight),accompanyLeft:Boolean(saved.accompanyLeft),accompanyRight:Boolean(saved.accompanyRight)};
}
function endCurrentPlayback(){ if(playbackState!==PT_PLAYBACK_STATE.STOPPED) stop(); setPlaybackState(PT_PLAYBACK_STATE.STOPPED); }
async function applyLesson(){
  try{ const candidate=lessonFromControls(); validateLesson(candidate); endCurrentPlayback(); lesson=candidate; saveLessonPreference(lesson); lessonDirty=false; updateLessonUI(); showPassageStart(); setPlaybackState(PT_PLAYBACK_STATE.STOPPED); console.log('[LESSON] Aplicada:',lesson); return true; }
  catch(e){alert(e.message);return false;}
}
async function ensureSessionIsCurrent(){ return lessonDirty ? applyLesson() : true; }
function buildCanonical(){ jsonScore=new MusicXMLParser(480).parse(xmlText); output.textContent=JSON.stringify(jsonScore,null,2); }
async function renderScore(xml){
  const target=$('#score');
  disconnectMeasureHighlightObserver();
  target.innerHTML='';
  try{
    osmd??=new opensheetmusicdisplay.OpenSheetMusicDisplay(target,{
      backend:'svg',autoResize:true,drawTitle:false,drawComposer:false,drawCredits:false,followCursor:followScoreInput.checked,
      cursorsOptions:[{type:0,color:OSMD_CURSOR_NORMAL_COLOR,alpha:0.32,follow:followScoreInput.checked}]
    });
    await osmd.load(xmlWithEvaluatedNoteColors(xml));
    osmd.render();
    osmd.enableOrDisableCursors?.(true);
    configureScoreFollowing();
    resetScoreCursor(false); setCursorAppearance(editMode);
    renderMeasureHighlights();
    observeMeasureHighlights();
  }catch(e){target.textContent=`No se pudo mostrar la partitura: ${e.message}`;console.error(e);}
}


// Identificación estable de las notas esperadas: índices MusicXML de origen.
function expectedSourceKey(note){
  if(!Number.isInteger(note?.sourceMeasureIndex)||!Number.isInteger(note?.sourceNoteIndex))return null;
  return `${note.sourceMeasureIndex}:${note.sourceNoteIndex}`;
}
// Etiquetas musicales aproximadas, medidas en negras (una negra = 1).
const PT_MUSICAL_FIGURES=[
  [4,'redonda'],[3,'blanca con puntillo'],[2,'blanca'],[1.5,'negra con puntillo'],
  [1,'negra'],[0.75,'corchea con puntillo'],[0.5,'corchea'],[0.375,'semicorchea con puntillo'],
  [0.25,'semicorchea'],[0.125,'fusa'],[0.0625,'semifusa']
];
function nearestFigure(quarters){
  if(!(quarters>0))return 'una duración muy breve';
  const best=PT_MUSICAL_FIGURES.reduce((a,b)=>Math.abs(Math.log2(b[0]/quarters))<Math.abs(Math.log2(a[0]/quarters))?b:a);
  return `una ${best[1]}`;
}
function pitchName(midi){
  if(!Number.isFinite(midi))return 'nota';
  const names=['Do','Do♯','Re','Re♯','Mi','Fa','Fa♯','Sol','Sol♯','La','La♯','Si'];
  return `${names[((midi%12)+12)%12]}${Math.floor(midi/12)-1}`;
}
// La figura esperada procede del MusicXML que originó la nota mostrada;
// no se reconstruye invirtiendo un tiempo absoluto a un BPM arbitrario.
function writtenFigureForExpected(expected,xmlDocument){
  const canonical=(jsonScore?.events??[]).find(e=>e.type==='note'&&
    e.sourceMeasureIndex===expected?.sourceMeasureIndex&&e.sourceNoteIndex===expected?.sourceNoteIndex);
  const sourceIndex=expected?.sourceMeasureIndex, noteIndex=expected?.sourceNoteIndex;
  const movementOffset=movements[currentMovementIndex]?.start??0;
  const node=xmlDocument&&Number.isInteger(sourceIndex)&&Number.isInteger(noteIndex)
    ?noteElementInDocument(xmlDocument,movementOffset+sourceIndex,noteIndex):null;
  const type=node?.querySelector(':scope > type')?.textContent?.trim();
  const byType={maxima:32,long:16,breve:8,whole:4,half:2,quarter:1,eighth:.5,'16th':.25,'32nd':.125,'64th':.0625,'128th':.03125};
  if(type&&Number.isFinite(byType[type])){
    let factor=1,increment=.5;
    for(const _ of node.querySelectorAll(':scope > dot')){factor+=increment;increment/=2;}
    const quarters=byType[type]*factor;
    const written=PT_MUSICAL_FIGURES.find(([q])=>Math.abs(q-quarters)<1e-8);
    if(written)return {quarters,label:`una ${written[1]}`};
    return {quarters,label:nearestFigure(quarters)};
  }
  const quarters=canonical&&jsonScore?.ppq>0?(canonical.endTick-canonical.startTick)/jsonScore.ppq
    :Math.max(0,(expected.endTick-expected.startTick)/(jsonScore?.ppq||480));
  return {quarters,label:nearestFigure(quarters)};
}
function errorDiagnostic(item,evaluation,bpm,xmlDocument=null){
  if(!item?.expected)return [];
  if(item.match==='OMITTED')return [{kind:'omitted',message:'Has omitido esta nota.'}];
  if(item.match!=='MATCHED')return [];
  const expected=item.expected,captured=item.captured;
  const expectedDuration=expected.timeOff-expected.timeOn;
  const capturedDuration=captured?.timeOff-captured?.timeOn;
  const written=writtenFigureForExpected(expected,xmlDocument);
  const errors=[];
  const kinds=noteErrorKinds(item,evaluation);
  if(kinds.includes('pitch')){
    const capturedLabel=pitchName(captured.pitch);
    const expectedLabel=Math.abs(captured.pitch-expected.pitch)<12
      ? pitchName(expected.pitch).replace(/-?\d+$/,'')+(pitchName(expected.pitch).includes('♯')?'':' natural')
      : pitchName(expected.pitch);
    errors.push({kind:'pitch',message:`Has interpretado ${capturedLabel} en lugar de ${expectedLabel}.`});
  }
  if(kinds.includes('timing')){
    const difference=captured.timeOn-expected.timeOn;
    // La duración esperada ya incorpora el tempo/offset efectivos de ESTE compás.
    const msPerQuarter=written.quarters>0&&expectedDuration>0?expectedDuration/written.quarters:60000/(Number(bpm)>0?bpm:80);
    errors.push({kind:'timing',message:`Te has ${difference<0?'adelantado':'retrasado'} el tiempo equivalente a ${nearestFigure(Math.abs(difference)/msPerQuarter)}.`});
  }
  if(evaluation.duration&&expectedDuration>0&&Number.isFinite(capturedDuration)&&kinds.includes('duration')){
    const ratio=capturedDuration/expectedDuration;
    const performed=nearestFigure(Math.max(0,written.quarters*ratio));
    // La aproximación musical no debe crear un error nuevo y, si da la
    // figura escrita, evitamos comunicar un error contradictorio.
    if(performed!==written.label){
      errors.push({kind:'duration',message:`Has mantenido ${performed} cuando se esperaba ${written.label}.`});
    }
  }
  return errors;
}
function updateEvaluationPresentation(consolidated,results){
  evaluatedNotes.clear();evaluatedMeasures.clear();evaluatedMessages.clear();evaluatedUnexpected=[];reviewEntries=[];reviewMode=false;reviewIndex=-1;reviewMessage=null;
  const evaluation=consolidated.evaluation??{};
  const diagnosticXml=new DOMParser().parseFromString(xmlText,'application/xml');
  const byMeasure=new Map((results.byMeasure??[]).map(row=>[row.measure,row]));
  let lastExpected=null;
  for(const item of consolidated.items??[]){
    if(item.expected)lastExpected=item.expected;
    if(item.match!=='UNEXPECTED')continue;
    const t=item.captured?.timeOn;
    if(!Number.isFinite(t))continue;
    const alternatives=(consolidated.items??[]).filter(i=>i.expected&&Number.isFinite(i.expected.timeOn));
    const nearest=alternatives.reduce((best,i)=>!best||Math.abs(i.expected.timeOn-t)<Math.abs(best.expected.timeOn-t)?i:best,null);
    const anchor=nearest?.expected??lastExpected;
    if(!anchor||!byMeasure.has(anchor.measure))continue;
    const ppq=jsonScore?.ppq||480,bpm=Number(bpmInput.value)||80;
    const relativeTicks=(t-(anchor.timeOn??t))*bpm*ppq/60000;
    const first=measureStartTick(anchor.measure),next=measureStartTick(anchor.measure+1);
    const tick=Math.max(first??anchor.startTick,Math.min((next??(first+4*ppq))-1,anchor.startTick+relativeTicks));
    const marker={measure:anchor.measure,tick,pitch:item.captured.pitch,timeOn:t};
    if(!evaluatedUnexpected.some(x=>x.measure===marker.measure&&Math.abs(x.tick-marker.tick)<ppq*0.08))evaluatedUnexpected.push(marker);
  }
  const priority={omitted:4,pitch:3,timing:2,duration:1};
  for(const item of consolidated.items??[]){
    const key=expectedSourceKey(item.expected);
    const diagnostics=errorDiagnostic(item,evaluation,lesson?.bpm,diagnosticXml);
    if(key&&diagnostics.length){
      evaluatedMessages.set(key,diagnostics.map(d=>d.message));
      const kind=diagnostics[0].kind; // prioridad: omisión, altura, ataque, duración.
      if(!evaluatedNotes.has(key)||priority[kind]>priority[evaluatedNotes.get(key)])evaluatedNotes.set(key,kind);
    }
  }
  for(const row of results.byMeasure??[]){
    if(Number.isFinite(row.compliance))evaluatedMeasures.set(row.measure,complianceColor(row.compliance));
  }
  reviewEntries=buildReviewEntries(consolidated.items??[],(jsonScore?.events??[]).filter(e=>e.type==='note'),
    item=>errorDiagnostic(item,evaluation,lesson?.bpm,diagnosticXml),pitchName);
  for(const [markerIndex,item] of evaluatedUnexpected.entries())reviewEntries.push({tick:item.tick,measure:item.measure,message:`Compás ${item.measure} · Pulsación inesperada: ${pitchName(item.pitch)}.`,unexpected:true,markerIndex});
  reviewEntries.sort((a,b)=>a.tick-b.tick||Number(a.unexpected)-Number(b.unexpected));
  showEvaluationMeasureBackgrounds=true;
  refreshEditFeedback();
  refreshEvaluationPresentation();
}
function applyEvaluatedNoteColors(){
  const measures=osmd?.Sheet?.SourceMeasures??[];
  for(let mi=0;mi<measures.length;mi++){
    const measure=measures[mi];
    // SourceNotes indexadas igual que en el parser MusicXML, incluyendo silencios.
    // Para evitar que un mismo acorde termine coloreado por un error de otra nota,
    // se recorren las notas por identidad de origen, no por pitch.
    const staffContainers=measure?.VerticalSourceStaffEntryContainers??[];
    for(const container of staffContainers){
      for(const entry of container?.StaffEntries??[]){
        for(const voice of entry?.VoiceEntries??[]){
          for(const note of voice?.Notes??[]){
            const ix=note?.SourceNoteIndex??note?.sourceNoteIndex;
            // El índice fuente no está disponible en todas las versiones de OSMD;
            // en tal caso la coloración exacta se hace sobre XML temporal (abajo).
            if(!Number.isInteger(ix))continue;
            const color=PT_ERROR_COLOR[evaluatedNotes.get(`${mi}:${ix}`)];
            if(color){note.NoteheadColor=color;note.noteheadColor=color;}
          }
        }
      }
    }
  }
}
function xmlWithEvaluatedNoteColors(xml){
  if(!evaluatedNotes.size)return xml;
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))return xml;
  const part=doc.querySelector('score-partwise > part');
  if(!part)return xml;
  const measures=[...part.children].filter(n=>n.localName==='measure');
  for(let mi=0;mi<measures.length;mi++){
    const notes=[...measures[mi].children].filter(n=>n.localName==='note');
    for(let ni=0;ni<notes.length;ni++){
      const color=PT_ERROR_COLOR[evaluatedNotes.get(`${mi}:${ni}`)];
      if(color)notes[ni].setAttribute('color',color);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
function disconnectMeasureHighlightObserver(){
  conceptualHighlightObserver?.disconnect();conceptualHighlightObserver=null;
  if(conceptualHighlightFrame)cancelAnimationFrame(conceptualHighlightFrame);
  conceptualHighlightFrame=0;conceptualHighlightSvg=null;
}
function observeMeasureHighlights(){
  const container=$('#score');if(!container)return;
  conceptualHighlightObserver?.disconnect();
  conceptualHighlightSvg=container.querySelector('svg');
  conceptualHighlightObserver=new MutationObserver(()=>{
    const hasOutside=lesson&&(Number(fromInput.value)>1||Number(toInput.value)<jsonScore?.measures);
    if(!activeListening&&!hasOutside&&!(showEvaluationMeasureBackgrounds&&evaluatedMeasures.size))return;
    const svg=container.querySelector('svg');
    if(svg===conceptualHighlightSvg&&svg?.querySelector('[data-pt-measure-background]'))return;
    if(conceptualHighlightFrame)return;
    conceptualHighlightFrame=requestAnimationFrame(()=>{
      conceptualHighlightFrame=0;conceptualHighlightSvg=container.querySelector('svg');
      renderMeasureHighlights();
    });
  });
  conceptualHighlightObserver.observe(container,{childList:true,subtree:true});
}
// Los overlays de compás deben ser fondo, nunca una cubierta del cursor de OSMD.
function keepActiveCursorAboveHighlights(){
  if(!activeListening)return;
  const score=$('#score');
  if(!score)return;
  // En ciertas versiones de OSMD el cursor es un div superpuesto y en otras
  // un grupo SVG; en ambos casos elevamos solo esa capa, no la partitura.
  for(const element of score.querySelectorAll('.cursor, [class*="cursor" i], [id*="cursor" i]')){
    if(element.closest('[data-pt-measure-background]'))continue;
    if(element instanceof HTMLElement){
      element.style.position=element.style.position||'absolute';
      element.style.zIndex='30';
      element.style.pointerEvents='none';
    }else if(element instanceof SVGElement && element.parentNode && !element.hasAttribute('data-pt-measure-background')){
      element.parentNode.appendChild(element);
    }
  }
  if(osmd?.cursor){osmd.cursor.show();}
}
function renderMeasureHighlights(){
  if(!osmd||!jsonScore)return;
  const svg=$('#score svg');if(!svg)return;
  const graphic=osmd.GraphicSheet??osmd.graphic;
  const rows=graphic?.MeasureList??graphic?.measureList??[];
  // Conservar el comportamiento validado en v0.55: insertar el fondo detrás
  // de la notación y volver a crearlo si OSMD sustituye su SVG.
  const existing=[...svg.querySelectorAll('[data-pt-measure-background]')];
  for(const node of existing)node.remove();
  const firstMeasure=Number(jsonScore.events.find(e=>e.type==='startOfMeasure')?.measure??1);
  const out=[];
  for(let mi=0;mi<rows.length;mi++){
    const measure=firstMeasure+mi;
    const isOutside=lesson&&(measure<Number(fromInput.value)||measure>Number(toInput.value));
    const color=activeListening
      ? (measure===activeWaitingMeasure?ACTIVE_WAITING_COLOR:(activeInitialVisitedMeasures.has(measure)?'#ffffff':(isOutside?PT_OUTSIDE_LESSON_COLOR:'#ffffff')))
      : (isOutside?PT_OUTSIDE_LESSON_COLOR:(showEvaluationMeasureBackgrounds?evaluatedMeasures.get(measure):null));
    if(!color)continue;
    const graphical=Array.isArray(rows[mi])?rows[mi].filter(Boolean):[];
    const boxes=[];
    for(const m of graphical){
      const stave=m.stave??m.Stave;
      const x=stave?.getX?.(),y=stave?.getY?.(),w=stave?.getWidth?.(),bottom=stave?.getBottomLineY?.();
      if([x,y,w,bottom].every(Number.isFinite)&&w>0&&bottom>y)boxes.push({x,y,right:x+w,bottom});
    }
    if(!boxes.length){
      const factor=10*(osmd.Zoom??osmd.zoom??1);
      for(const m of graphical){
        const bb=m.PositionAndShape,pos=bb?.AbsolutePosition,w=bb?.Size?.width;
        if(pos&&[pos.x,pos.y,w].every(Number.isFinite)&&w>0){
          boxes.push({x:pos.x*factor,y:pos.y*factor,right:(pos.x+w)*factor,bottom:(pos.y+(m.ParentStaffLine?.StaffHeight??4))*factor});
        }
      }
    }
    if(!boxes.length)continue;
    const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
    const right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));
    if(![x,y,right,bottom].every(Number.isFinite)||right<=x||bottom<=y)continue;
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('data-pt-measure-background',String(measure));
    for(const [name,val] of Object.entries({x,y,width:right-x,height:bottom-y,fill:color,'fill-opacity':activeListening?(measure===activeWaitingMeasure?ACTIVE_WAITING_OPACITY:1):(isOutside?PT_OUTSIDE_LESSON_ALPHA:PT_EVALUATION_MEASURE_ALPHA),'pointer-events':'none'}))rect.setAttribute(name,String(val));
    out.push(rect);
  }
  // Los puntos inesperados se superponen sin alterar MusicXML.
  if(!out.length){renderUnexpectedMarkers(svg);keepActiveCursorAboveHighlights();return;}
  const isBackground=el=>{
    if(el.localName!=='rect')return false;
    const fill=(el.getAttribute('fill')??el.style.fill??'').toLowerCase();
    return ['white','#fff','#ffffff','rgb(255,255,255)'].includes(fill)||/background/i.test(el.getAttribute('class')??'');
  };
  const pageBackground=[...svg.children].find(isBackground);
  if(pageBackground){for(const rect of out)pageBackground.after(rect);}
  else {const anchor=svg.firstElementChild;for(const rect of out)svg.insertBefore(rect,anchor);}
  renderUnexpectedMarkers(svg);
  keepActiveCursorAboveHighlights();
}
function renderUnexpectedMarkers(svg){
  svg.querySelectorAll('[data-pt-unexpected]').forEach(el=>el.remove());
  for(const [markerIndex,marker] of evaluatedUnexpected.entries()){
    const box=svg.querySelector(`[data-pt-measure-background="${marker.measure}"]`);
    if(!box)continue;
    const start=measureStartTick(marker.measure),end=measureStartTick(marker.measure+1);
    const proportion=Math.max(0,Math.min(1,(marker.tick-start)/((end??(start+4*(jsonScore?.ppq||480)))-start)));
    const x=Number(box.getAttribute('x'))+Number(box.getAttribute('width'))*(0.08+proportion*0.84);
    const y=Number(box.getAttribute('y'))+Number(box.getAttribute('height'))*.50;
    const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
    for(const [key,val] of Object.entries({cx:x,cy:y,r:4.5,fill:'#ea2027',stroke:'#fff','stroke-width':1,'data-pt-unexpected':marker.measure,'data-pt-unexpected-index':markerIndex,'pointer-events':'none'}))circle.setAttribute(key,String(val));
    svg.append(circle);
  }
  updateSelectedUnexpectedMarker();
}
function refreshEvaluationPresentation(){
  if(!osmd||!xmlText)return;
  // Una recarga es necesaria para restaurar limpiamente los colores originales
  // cuando algunas notas dejan de estar falladas. No se modifica sourceXmlText.
  const tick=lastCursorTick;
  renderScore(xmlText).then(()=>{if(Number.isFinite(tick))moveScoreCursor(tick,true);else showPassageStart();})
    .catch(error=>console.warn('[OSMD] Error al actualizar colores:',error));
}
function clearEvaluationMeasureBackgrounds(){
  showEvaluationMeasureBackgrounds=false;
  renderMeasureHighlights();
}

function openRecentScoreDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(RECENT_SCORE_DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(RECENT_SCORE_STORE))request.result.createObjectStore(RECENT_SCORE_STORE);};
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
}
async function saveRecentScore(name,xml){
  try{const db=await openRecentScoreDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction(RECENT_SCORE_STORE,'readwrite');tx.objectStore(RECENT_SCORE_STORE).put({name,xml},RECENT_SCORE_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}
  catch(error){console.warn('[STORAGE] No se pudo guardar el último MusicXML:',error);}
}
async function getRecentScore(){
  try{const db=await openRecentScoreDatabase();const value=await new Promise((resolve,reject)=>{const tx=db.transaction(RECENT_SCORE_STORE,'readonly');const request=tx.objectStore(RECENT_SCORE_STORE).get(RECENT_SCORE_KEY);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});db.close();return value;}
  catch(error){console.warn('[STORAGE] No se pudo recuperar el último MusicXML:',error);return null;}
}
async function activateMovement(index){
  if(!sourceXmlText||!movements.length)return false;
  currentMovementIndex=Math.max(0,Math.min(movements.length-1,Number(index)||0));
  movementInput.value=String(currentMovementIndex);
  xmlText=movementXml(sourceXmlText,movements[currentMovementIndex]);
  buildCanonical();
  lesson=initialLessonForScore();lessonDirty=false;
  updateLessonUI();setPlaybackState(PT_PLAYBACK_STATE.STOPPED);
  await renderScore(xmlText);showPassageStart();
  return true;
}
async function forceStopBeforeMusicLoad(){
  if(playbackState===PT_PLAYBACK_STATE.STOPPED)return;
  const wasRecording=isRecording();
  midiStopPromise=stopMidiSession();await midiStopPromise;
  if(wasRecording)logCapturedPerformance();
  sessionIsRecording=false;setPlaybackState(PT_PLAYBACK_STATE.STOPPED);updateMidiControls();
}
async function loadMusicXML(xml,name='',remember=false){
  await forceStopBeforeMusicLoad();
  sourceXmlText=xml;
  currentScoreName=(name||'partitura.musicxml').replace(/[\\/:*?"<>|]+/g,'_');
  scoreModified=false; if(downloadMusicXMLButton)downloadMusicXMLButton.disabled=true;
  try{
    metadataOutput.textContent=scoreMetadata(sourceXmlText,name); metadataOutput.title=metadataOutput.textContent;
    movements=detectMovements(sourceXmlText);
    const saved=storedLessonPreference();
    currentMovementIndex=Math.max(0,Math.min(movements.length-1,(Number(saved?.movement)||1)-1));
    fillMovementSelect();
    await activateMovement(currentMovementIndex);
    if(remember)await saveRecentScore(name,sourceXmlText);
    return true;
  }catch(e){
    sourceXmlText='';xmlText='';movements=[];currentMovementIndex=0;jsonScore=null;lesson=null;currentSession=null;movementInput.innerHTML='';
    metadataOutput.textContent=remember?`ERROR: ${e.message}`:'Ningún archivo cargado'; metadataOutput.title=metadataOutput.textContent;
    if(remember)console.error(e); else console.warn('[STORAGE] Se ignoró el MusicXML recordado porque no pudo cargarse.',e);
    return false;
  }
}
fileInput.addEventListener('change',async()=>{
  const file=fileInput.files[0];if(!file)return;
  await forceStopBeforeMusicLoad();
  await loadMusicXML(await file.text(),file.name,true);
});
downloadMusicXMLButton?.addEventListener('click',()=>{
  if(!sourceXmlText||!scoreModified)return;
  const blob=new Blob([sourceXmlText],{type:'application/vnd.recordare.musicxml+xml;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=currentScoreName||'partitura.musicxml';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
});
loadUrlButton.addEventListener('click',()=>{
  try{urlInput.value=localStorage.getItem(STORAGE_LAST_URL)||'';}catch{urlInput.value='';}
  urlDialog.showModal();
  requestAnimationFrame(()=>urlInput.focus());
});
urlCancelButton.addEventListener('click',()=>urlDialog.close());
async function loadMusicXMLFromUrl(url,{rememberUrl=false}={}){
  await forceStopBeforeMusicLoad();
  const response=await fetch(url);
  if(!response.ok)throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  const xml=await response.text();
  const name=(()=>{try{return decodeURIComponent(new URL(url,location.href).pathname.split('/').filter(Boolean).pop()||'MusicXML por URL');}catch{return 'MusicXML por URL';}})();
  const loaded=await loadMusicXML(xml,name,true);
  if(!loaded)throw new Error('El contenido recibido no pudo cargarse como MusicXML.');
  if(rememberUrl){try{localStorage.setItem(STORAGE_LAST_URL,url);}catch(error){console.warn('[STORAGE] No se pudo guardar la última URL:',error);}}
  return true;
}
urlForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const url=urlInput.value.trim();
  if(!url)return;
  urlDialog.close();
  loadUrlButton.disabled=true;
  try{await loadMusicXMLFromUrl(url,{rememberUrl:true});}
  catch(error){
    alert(`No se pudo cargar el MusicXML desde la URL.\n\n${error.message}\n\nSi la dirección es correcta, el servidor puede estar bloqueando la petición por CORS.`);
    console.error('[URL] Error al cargar MusicXML:',error);
  }finally{loadUrlButton.disabled=false;}
});
movementInput.addEventListener('change',async()=>{
  if(!sourceXmlText)return;
  const previousIndex=currentMovementIndex;
  try{
    // Conserva BPM/rango del movimiento que abandonamos y las opciones comunes actuales.
    if(lesson){const current=lessonFromControls();validateLesson(current);saveLessonPreference(current);}
    endCurrentPlayback();
    currentMovementIndex=Number(movementInput.value)||0;
    // Persiste inmediatamente qué movimiento queda seleccionado.
    const saved=storedLessonPreference()??{};
    try{localStorage.setItem(STORAGE_LESSON,JSON.stringify({...saved,movement:currentMovementIndex+1}));}catch(error){console.warn('[STORAGE] No se pudo guardar el movimiento:',error);}
    await activateMovement(currentMovementIndex);
  }catch(error){currentMovementIndex=previousIndex;movementInput.value=String(previousIndex);alert(error.message);console.error(error);}
});
for(const button of document.querySelectorAll('[data-session-mode]')) button.addEventListener('click',()=>{sessionModeInput.value=button.dataset.sessionMode;updateSessionModeButtons();updateAccompanyControls(true);markLessonDirty();});
loopInput.addEventListener('click',()=>{setLoopControl(loopInput.getAttribute('aria-pressed')!=='true');markLessonDirty();});

function measureBoundsFor(input){
  if(!jsonScore)return {min:1,max:1};
  if(input===fromInput)return {min:1,max:Math.max(1,Math.trunc(Number(toInput.value)||jsonScore.measures))};
  return {min:Math.max(1,Math.trunc(Number(fromInput.value)||1)),max:jsonScore.measures};
}
function syncMeasureInputBounds(){
  if(!jsonScore)return;
  fromInput.min='1'; fromInput.max=String(Math.max(1,Math.trunc(Number(toInput.value)||jsonScore.measures)));
  toInput.min=String(Math.max(1,Math.trunc(Number(fromInput.value)||1))); toInput.max=String(jsonScore.measures);
}
function normalizedMeasureValue(input){
  const {min,max}=measureBoundsFor(input);
  return Math.max(min,Math.min(max,Math.trunc(Number(input.value)||min)));
}
async function setCurrentMeasure(targetInput){
  const current=currentMeasure(); if(current==null){alert('El cursor todavía no apunta a un compás.');return;}
  const {min,max}=measureBoundsFor(targetInput);
  targetInput.value=Math.max(min,Math.min(max,current));
  previewMeasureInput(targetInput); syncMeasureInputBounds(); markLessonDirty();
}
setFromCurrentButton.addEventListener('click',()=>setCurrentMeasure(fromInput));
setToCurrentButton.addEventListener('click',()=>setCurrentMeasure(toInput));
resetMeasureRangeButton.addEventListener('click',()=>{
  if(!jsonScore)return;
  fromInput.value=1; toInput.value=jsonScore.measures; syncMeasureInputBounds();
  const tick=measureStartTick(1); if(Number.isFinite(tick))moveScoreCursor(tick,true);
  markLessonDirty();
});
function previewMeasureInput(input){
  if(!jsonScore)return; const measure=normalizedMeasureValue(input); input.value=measure; syncMeasureInputBounds();
  const tick=measureStartTick(measure); if(Number.isFinite(tick))moveScoreCursor(tick,true);
}
function previewMeasureWhileEditing(input){
  if(!jsonScore)return;
  const raw=Math.trunc(Number(input.value)); if(!Number.isInteger(raw))return;
  const {min,max}=measureBoundsFor(input); const measure=Math.max(min,Math.min(max,raw));
  if(measure!==raw)input.value=measure; syncMeasureInputBounds();
  const tick=measureStartTick(measure); if(Number.isFinite(tick))moveScoreCursor(tick,true);
}
fromInput.addEventListener('input',()=>{previewMeasureWhileEditing(fromInput);markLessonDirty();renderMeasureHighlights();});
toInput.addEventListener('input',()=>{previewMeasureWhileEditing(toInput);markLessonDirty();renderMeasureHighlights();});
fromInput.addEventListener('change',()=>{previewMeasureInput(fromInput);markLessonDirty();});
toInput.addEventListener('change',()=>{previewMeasureInput(toInput);markLessonDirty();});
for(const button of document.querySelectorAll('[data-bpm-delta]')) button.addEventListener('click',()=>{ bpmInput.value=Math.max(1,(Number(bpmInput.value)||1)+Number(button.dataset.bpmDelta)); markLessonDirty(); });
bpmInput.addEventListener('input',markLessonDirty);
introInput.addEventListener('change',markLessonDirty);
metronomeInput.addEventListener('change',()=>{updateAccompanyControls(true);markLessonDirty();});
evaluateDurationInput.addEventListener('change',markLessonDirty);
evaluateDynamicsInput.addEventListener('change',markLessonDirty);
playLeftInput.addEventListener('change',markLessonDirty);
playRightInput.addEventListener('change',markLessonDirty);
recordLeftInput.addEventListener('change',()=>{updateAccompanyControls(true);markLessonDirty();});
recordRightInput.addEventListener('change',()=>{updateAccompanyControls(true);markLessonDirty();});
accompanyLeftInput.addEventListener('change',markLessonDirty);
accompanyRightInput.addEventListener('change',markLessonDirty);

function sessionCursorTicks(){
  if(!jsonScore||!currentSession)return [];
  const {fromMeasure,toMeasure}=currentSession.config;
  return [...new Set(jsonScore.events
    .filter(event=>event.type==='note'&&event.measure>=fromMeasure&&event.measure<=toMeasure)
    .map(event=>event.startTick)
    .filter(Number.isFinite))].sort((a,b)=>a-b);
}
function cursorTickAtSessionTime(elapsedMs,ticks){
  if(!currentSession||!ticks.length)return null;
  const config=currentSession.config;
  const musicalElapsed=elapsedMs-(config.passageStartTime??0);
  if(musicalElapsed<0)return null;
  const timelineTick=config.originTick+musicalElapsed*config.bpm*config.ppq/60000;
  let lo=0,hi=ticks.length-1,best=-1;
  while(lo<=hi){const mid=(lo+hi)>>1;if(ticks[mid]<=timelineTick){best=mid;lo=mid+1;}else hi=mid-1;}
  return best>=0?ticks[best]:config.originTick;
}
function startSessionPlayback({recordingOverride=null,introLabel='INTRO',allowLoop=true,renderEvaluation=null,onComplete=null}={}){
  sessionIsRecording=recordingOverride==null?isRecordingLesson():Boolean(recordingOverride);
  const cursorTicks=sessionCursorTicks();
  if(sessionIsRecording)clearEvaluationMeasureBackgrounds();
  showPassageStart();setPlaybackState(PT_PLAYBACK_STATE.PLAYING);
  play(currentSession.playbackSequence,{
    onStart:startedAt=>{
      // Capturamos también durante la introducción. El cero temporal de la
      // grabación es el inicio musical del pasaje; la intro queda en negativo.
      if(sessionIsRecording)startRecording(startedAt+(currentSession.config.passageStartTime??0));
    },
    // El cursor visual sigue el reloj de la sesión, no la existencia de MIDI OUT.
    // Así también avanza durante una grabación completamente silenciosa.
    onClock:elapsedMs=>{
      const tick=cursorTickAtSessionTime(elapsedMs,cursorTicks);
      if(Number.isFinite(tick)&&tick!==lastCursorTick)moveScoreCursor(tick);
    },
    onEvent:event=>{
      if(event.type===PT_EVENT.METRONOME){
        if(event.timeOn<(currentSession.config.passageStartTime??0)) showIntroStatus(event,introLabel);
        else showActiveSessionStatus({pulse:true});
      }
      if(event.type===PT_EVENT.PASSAGE_START){
        showActiveSessionStatus();
        return;
      }
      if(event.type===PT_EVENT.PASSAGE_END){
        if(isRecording())logCapturedPerformance(stopRecording(),{renderEvaluation:renderEvaluation??lesson?.sessionMode==='evaluate'});
        return;
      }
      if(event.type!==PT_EVENT.METRONOME&&Number.isFinite(event.startTick))moveScoreCursor(event.startTick);
    },
    onEnd:()=>{
      if(isRecording())logCapturedPerformance(stopRecording(),{renderEvaluation:renderEvaluation??lesson?.sessionMode==='evaluate'});
      if(typeof onComplete==='function'){onComplete();return;}
      if(allowLoop&&lesson?.loop){showPassageStart();startSessionPlayback();return;}
      sessionIsRecording=false;setPlaybackState(PT_PLAYBACK_STATE.STOPPED);resetScoreCursor(false);positionMeasure.textContent='—';positionBeat.textContent='—';releaseMidiIfIdle().finally(updateMidiControls);
    }
  });
}
function startFreeRecordingSession({introLabel='INTRO',restoreSessionOnStop=false}={}){
  sessionIsRecording=true;
  clearEvaluationMeasureBackgrounds();
  freeRecordingActive=false;
  restoreSessionAfterFreeRecording=Boolean(restoreSessionOnStop);
  showPassageStart();
  setPlaybackState(PT_PLAYBACK_STATE.PLAYING);
  const passageStart=currentSession?.config?.passageStartTime??0;
  const introEvents=(currentSession?.playbackSequence??[]).filter(event=>
    (event.type===PT_EVENT.METRONOME&&event.timeOn<passageStart)||event.type===PT_EVENT.PASSAGE_START
  );
  const hasIntro=introEvents.some(event=>event.type===PT_EVENT.METRONOME);
  const beginCapture=()=>{
    if(!isRecording())startRecording(performance.now());
    freeRecordingActive=true;
    showActiveSessionStatus();
  };
  if(!hasIntro){beginCapture();return;}
  play(introEvents,{
    onEvent:event=>{
      if(event.type===PT_EVENT.METRONOME)showIntroStatus(event,introLabel);
      else if(event.type===PT_EVENT.PASSAGE_START)beginCapture();
    },
    onEnd:()=>{if(playbackState===PT_PLAYBACK_STATE.PLAYING&&!freeRecordingActive)beginCapture();}
  });
}

async function startStoppedSession(){
  const wasDirty=lessonDirty;
  if(!await ensureSessionIsCurrent())return false;
  if(!wasDirty)rebuildSession();
  sessionIsRecording=isRecordingLesson();
  if(lesson.sessionMode!=='listen'&&!sessionIsRecording)throw new Error('Selecciona al menos una mano en «Grabar» para iniciar esta sesión.');
  if(sessionIsRecording&&!midiIn.value)throw new Error('No hay MIDI IN seleccionado para grabar.');
  if(sessionIsRecording)clearEvaluationMeasureBackgrounds();
  await midiStopPromise;
  await openSelectedMidiPorts(sessionIsRecording?'recording':'playback');
  updateMidiControls();
  if(sessionIsRecording&&!lesson.metronome)startFreeRecordingSession();
  else startSessionPlayback();
  return true;
}
playButton.addEventListener('click',async()=>{leaveEditMode();if(activeListening){toggleActiveListeningPause();return;}try{
  if(playbackState===PT_PLAYBACK_STATE.PLAYING){
    if(freeRecordingActive){if(isRecording())pauseRecording();setPlaybackState(PT_PLAYBACK_STATE.PAUSED);return;}
    if(pause()){if(isRecording())pauseRecording();setPlaybackState(PT_PLAYBACK_STATE.PAUSED);}return;
  }
  if(playbackState===PT_PLAYBACK_STATE.PAUSED){
    if(freeRecordingActive){if(isRecording())resumeRecording();setPlaybackState(PT_PLAYBACK_STATE.PLAYING);showActiveSessionStatus();return;}
    if(resume()){if(isRecording())resumeRecording();setPlaybackState(PT_PLAYBACK_STATE.PLAYING);showActiveSessionStatus();}return;
  }
  await startStoppedSession();
}catch(e){sessionIsRecording=false;setPlaybackState(PT_PLAYBACK_STATE.STOPPED);resetScoreCursor(false);alert(e.message);console.error(e);}});
function measureStartTick(measure){ return jsonScore?.events.find(e=>e.type==='startOfMeasure'&&e.measure===measure)?.startTick ?? null; }
function sessionTimeForTick(tick){
  if(!currentSession||!Number.isFinite(tick))return 0;
  const {timelineOriginTick,bpm,ppq}=currentSession.config;
  return Math.max(0,(tick-timelineOriginTick)*60000/(bpm*ppq));
}
function seekToMeasure(measure){
  const target=Math.max(lesson.fromMeasure,Math.min(lesson.toMeasure,measure));
  const tick=measureStartTick(target); if(!Number.isFinite(tick))return false;
  if(playbackState!==PT_PLAYBACK_STATE.STOPPED) seek(sessionTimeForTick(tick));
  moveScoreCursor(tick); return true;
}
restartButton.addEventListener('click',async()=>{leaveEditMode();
  if(!await ensureSessionIsCurrent())return;
  if(playbackState===PT_PLAYBACK_STATE.STOPPED){showPassageStart();return;}
  if(freeRecordingActive){showPassageStart();return;}
  if(seek(0)){showPassageStart();setPlaybackState(playbackState);}
});
previousMeasureButton.addEventListener('click',async()=>{leaveEditMode();
  if(!await ensureSessionIsCurrent())return;
  const pos=measurePositionAtTick(lastCursorTick??lessonOriginTick()); if(!pos)return;
  const markerTick=measureStartTick(pos.measure);
  const atStart=Number.isFinite(markerTick)&&Math.abs((lastCursorTick??markerTick)-markerTick)<1;
  seekToMeasure(atStart?pos.measure-1:pos.measure);
});
nextMeasureButton.addEventListener('click',async()=>{leaveEditMode();
  if(!await ensureSessionIsCurrent())return;
  const pos=measurePositionAtTick(lastCursorTick??lessonOriginTick()); if(pos)seekToMeasure(pos.measure+1);
});
function isEditableTarget(target){return target instanceof HTMLElement&&(target.matches('input,select,textarea,[contenteditable="true"]')||Boolean(target.closest('[contenteditable="true"]')));}
function setCurrentMeasureShortcut(targetInput){
  if(!jsonScore)return false;
  const current=currentMeasure(); if(current==null)return false;
  const {min,max}=measureBoundsFor(targetInput);
  targetInput.value=Math.max(min,Math.min(max,current));
  syncMeasureInputBounds();
  // I/F pueden usarse durante reproducción: preparan la próxima sesión sin
  // detener ni reconstruir la que está sonando.
  lessonDirty=true;
  try{const candidate=lessonFromControls();validateLesson(candidate);saveLessonPreference(candidate);lessonOutput.textContent=JSON.stringify(candidate,null,2);}catch(error){console.warn('[LESSON] No se pudo guardar el nuevo límite:',error);}
  return true;
}
async function fullStop({returnToStart=true}={}){
  if(activeListening){await deactivateActiveListening();}
  leaveEditMode();
  const wasRecording=isRecording();
  const shouldRestoreSession=restoreSessionAfterFreeRecording;
  midiStopPromise=stopMidiSession();
  await midiStopPromise;
  if(wasRecording)logCapturedPerformance();
  freeRecordingActive=false;
  restoreSessionAfterFreeRecording=false;
  sessionIsRecording=false;
  if(shouldRestoreSession&&jsonScore&&lesson){try{rebuildSession();}catch(error){console.warn('[SESSION] No se pudo restaurar la sesión:',error);}}
  setPlaybackState(PT_PLAYBACK_STATE.STOPPED);
  updateMidiControls();
  if(returnToStart)showPassageStart();
}
async function keyboardStop(){await fullStop();}
async function setModeAndStart(mode){
  await fullStop();
  if(!jsonScore)return;
  sessionModeInput.value=mode;
  updateSessionModeButtons();
  lessonDirty=true;
  try{await startStoppedSession();}
  catch(error){sessionIsRecording=false;setPlaybackState(PT_PLAYBACK_STATE.STOPPED);resetScoreCursor(false);alert(error.message);console.error(error);}
}
function restoreSessionAfterRepeat(){
  sessionIsRecording=false;
  try{rebuildSession();}catch(error){console.warn('[SESSION] No se pudo restaurar la sesión tras Repetir:',error);}
  setPlaybackState(PT_PLAYBACK_STATE.STOPPED);
  resetScoreCursor(false);positionMeasure.textContent='—';positionBeat.textContent='—';
  releaseMidiIfIdle().finally(updateMidiControls);
}
async function startRepeatWorkflow(){
  await fullStop();
  if(!jsonScore)return;
  if(!await ensureSessionIsCurrent())return;
  const baseLesson={...lesson};
  if(!baseLesson.recordLeft&&!baseLesson.recordRight){
    alert('Selecciona al menos una mano en «Grabar» para usar Repetir.');
    return;
  }
  if(!midiIn.value){alert('No hay MIDI IN seleccionado para la fase «REPITE».');return;}
  const listenLesson={...baseLesson,sessionMode:'listen'};
  const recordLesson={...baseLesson,sessionMode:'evaluate',intro:true};
  const listenSession=createSession(jsonScore,listenLesson,sessionOptionsFor(listenLesson));
  const recordSession=createSession(jsonScore,recordLesson,sessionOptionsFor(recordLesson));
  try{
    await midiStopPromise;
    await openSelectedMidiPorts('repeat');
    updateMidiControls();
    currentSession=listenSession;
    startSessionPlayback({recordingOverride:false,introLabel:'ESCUCHA',allowLoop:false,onComplete:async()=>{
      try{
        currentSession=recordSession;
        showPassageStart();
        if(baseLesson.metronome){
          startSessionPlayback({recordingOverride:true,introLabel:'REPITE',allowLoop:false,renderEvaluation:true,onComplete:restoreSessionAfterRepeat});
        }else{
          startFreeRecordingSession({introLabel:'REPITE',restoreSessionOnStop:true});
        }
      }catch(error){restoreSessionAfterRepeat();alert(error.message);console.error(error);}
    }});
  }catch(error){
    currentSession=createSession(jsonScore,baseLesson,sessionOptionsFor(baseLesson));
    sessionIsRecording=false;setPlaybackState(PT_PLAYBACK_STATE.STOPPED);resetScoreCursor(false);
    alert(error.message);console.error(error);
  }
}
// Convención de depuración: buscar //debug.midi.active-listening para desactivar cada traza.
function activeLog(...args){/*debug.midi.active-listening console.log('[ACTIVE]',...args); */
}
// Un Note On y su Note Off breve forman un tap. Los vel. MIDI pueden variar.
function activeMeasureBeats(){
  const tick=lastCursorTick??lessonOriginTick();
  const markers=(jsonScore?.events??[]).filter(e=>e.type==='startOfMeasure'&&e.startTick<=tick);
  const marker=markers.at(-1)??(jsonScore?.events??[]).find(e=>e.type==='startOfMeasure');
  return Math.max(2,Math.min(32,Math.round(marker?.beats||4)));
}
function updateActiveMetronomeIndicator(){
  if(!activeMetronomeButton)return;
  const titles={off:'OFF',flexible:'FLEXIBLE',strict:'ESTRICTO'};
  const metronomeSvg='<svg viewBox="0 0 40 44" width="22" height="24" aria-hidden="true" style="vertical-align:middle;margin-right:5px"><path d="M18 5 L22 5 L35 38 L5 38 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><g fill="currentColor"><circle cx="20" cy="11" r="1"/><circle cx="20" cy="15" r="1"/><circle cx="20" cy="19" r="1"/><circle cx="20" cy="23" r="1"/><circle cx="20" cy="27" r="1"/></g><path d="M20 32 L2 2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M-4 -5 L4 -5 L2.4 4 L-2.4 4 Z" fill="currentColor" transform="translate(7 10) rotate(-31)"/><circle cx="20" cy="32" r="2" fill="currentColor"/><path d="M5 41 H35" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const displayBpm=activeMetronomeMode==='strict'&&activeListeningTempo
    ?Math.round(60000/activeListeningTempo.periodMs)
    :(activeMeasuredBpm||Number(bpmInput.value)||80);
  activeMetronomeButton.innerHTML=metronomeSvg+titles[activeMetronomeMode]+' · '+displayBpm+' BPM';
  activeMetronomeButton.disabled=!activeListening;
  activeMetronomeButton.title='Metrónomo: '+titles[activeMetronomeMode]+' · Cambiar modo (M)';
  activeMetronomeButton.setAttribute('aria-label',activeMetronomeButton.title);
}
function activeMeterRunning(){return (activeMetronomeMode==='strict'&&activeStrictTempoLocked)||(activeMetronomeMode==='flexible'&&!activeFlexSuspended);}
function clearActiveFlexStop(){
  activeFlexStopGeneration++;
  if(activeFlexStopTimer!==null){clearTimeout(activeFlexStopTimer);activeFlexStopTimer=null;}
}
function resetActiveFragment(startTime=null){
  activeCapturedEvents=[];activeFragmentStartTime=startTime;activeMelodyStarted=false;activeFirstMelodyTime=null;activeFirstMelodyTick=null;
  activeFragmentFirstMeasure=null;activeFragmentLastMeasure=null;
  activeFragmentHands=new Set();activeFragmentConfirmed=false;activeFragmentAnchors=[];
}
function noteEventsFromActiveCapture(events,endTime){
  const held=new Map(),notes=[];
  const origin=Number.isFinite(activeFragmentStartTime) ? activeFragmentStartTime : events.find(e=>e.type==='noteOn')?.time;
  for(const e of [...events].sort((a,b)=>a.time-b.time)){
    if(!Number.isFinite(e.time)||e.time<origin)continue;
    const key=`${e.channel}:${e.pitch}`;
    if(e.type==='noteOn'){
      const previous=held.get(key);
      if(previous){previous.timeOff=Math.max(previous.timeOn,e.time-origin);}
      const note={type:PT_EVENT.NOTE,pitch:e.pitch,channel:e.channel,velocity:e.velocity,timeOn:e.time-origin,timeOff:null};
      notes.push(note);held.set(key,note);
    }else if(e.type==='noteOff'){
      const note=held.get(key);
      if(note){note.timeOff=Math.max(note.timeOn,e.time-origin);held.delete(key);}
    }
  }
  for(const note of held.values())note.timeOff=Math.max(note.timeOn,endTime-origin);
  return notes.filter(n=>Number.isFinite(n.timeOff));
}
// Relaciona la posición escrita con los tiempos reales del alumno. La referencia
// puede variar entre compases; no imponemos el último BPM a todo el pasaje.
function activeExpectedTimeAtTick(tick,anchors,defaultBpm,ppq){
  const scale=bpm=>60000/(Math.max(1,bpm)*ppq);
  if(!anchors.length)return tick*scale(defaultBpm);
  if(anchors.length===1){const a=anchors[0];return a.time+(tick-a.tick)*scale(a.bpm);}
  if(tick<=anchors[0].tick){const a=anchors[0];return a.time+(tick-a.tick)*scale(a.bpm);}
  for(let i=1;i<anchors.length;i++){
    const a=anchors[i-1],b=anchors[i];
    if(tick<=b.tick){
      const dt=b.tick-a.tick;
      if(dt<=0)return b.time;
      const nominal=dt*scale(a.bpm||defaultBpm);
      if(b.time-a.time > nominal*2.5){
        // Pausa entre segmentos: no interpolar el silencio como si fuera
        // un ritardando gigantesco. Cada lado conserva su tempo local.
        const leftDistance=tick-a.tick,rightDistance=b.tick-tick;
        return leftDistance<=rightDistance?a.time+leftDistance*scale(a.bpm||defaultBpm)
          :b.time-rightDistance*scale(b.bpm||defaultBpm);
      }
      return a.time+(tick-a.tick)*(b.time-a.time)/dt;
    }
  }
  const a=anchors.at(-1);return a.time+(tick-a.tick)*scale(a.bpm);
}
function evaluateActiveFragment(){
  if(!activeFragmentConfirmed||!jsonScore||
     !Number.isInteger(activeFragmentFirstMeasure)||!Number.isInteger(activeFragmentLastMeasure))return;
  const events=activeCapturedEvents;
  // Los primeros ataques se capturan ANTES de confirmar el primer compás.
  // No descartarlos usando el instante de confirmación del reconocedor.
  const origin=Number.isFinite(activeFragmentStartTime)
    ? activeFragmentStartTime : events.find(e=>e.type==='noteOn')?.time;
  if(!Number.isFinite(origin))return;
  const captured={type:'CapturedPerformance',events:noteEventsFromActiveCapture(events,performance.now())};
  if(!captured.events.length)return;
  try{
    const config={...lessonFromControls(),fromMeasure:activeFragmentFirstMeasure,
      toMeasure:activeFragmentLastMeasure,bpm:activeFollowBpm||Number(bpmInput.value)||80,
      metronome:false,sessionMode:'evaluate',
      recordRight:activeFragmentHands.has('right'),recordLeft:activeFragmentHands.has('left')};
    const hand=handSelection(config.recordLeft,config.recordRight);
    if(hand===PT_HAND.NONE)return;
    // Vista del fragmento SOBRE la referencia inmutable. No reconstruir ni
    // volver a expandir mordentes desde los límites mutables de la lección.
    if(!activeFullExpectedPerformance)throw new Error('No existe referencia completa de Escucha activa.');
    const expected={...activeFullExpectedPerformance,
      fromMeasure:config.fromMeasure,toMeasure:config.toMeasure,
      hand,
      evaluation:{...activeFullExpectedPerformance.evaluation},
      events:activeFullExpectedPerformance.events.filter(e=>
        e.measure>=config.fromMeasure&&e.measure<=config.toMeasure&&
        (hand===PT_HAND.BOTH||(hand===PT_HAND.RIGHT?e.channel===0:e.channel===1))
      ).map(e=>({...e}))
    };
    // Tempo y Duración se habilitan expresamente: no dependen del checkbox
    // «usar metrónomo» convencional, sino del seguimiento de Escucha activa.
    const anchors=activeFragmentAnchors.filter(a=>Number.isFinite(a.tick)&&Number.isFinite(a.time))
      .sort((a,b)=>a.tick-b.tick||a.time-b.time);
    const uniqueAnchors=[];
    for(const a of anchors){
      if(uniqueAnchors.at(-1)?.tick===a.tick){
        // La referencia más reciente de un mismo tick puede corregir la anterior.
        uniqueAnchors[uniqueAnchors.length-1]=a;
      }else uniqueAnchors.push(a);
    }
    const ppq=jsonScore.ppq||480;
    const tempoReliable=uniqueAnchors.length>0;
    expected.evaluation.timing=activeSessionMetronomeMode!=='off'&&tempoReliable;
    expected.evaluation.duration=activeSessionMetronomeMode!=='off'&&Boolean(config.evaluateDuration);
    // Dinámica continúa sin métrica calculada; no crear puntuaciones ficticias.
    expected.evaluation.dynamics=false;
    // Entrada anticipada al tiempo fuerte: se identifica si el primer ataque
    // coincide con el inicio escrito del compás. Su instante MIDI queda
    // intacto, pero el origen de evaluación es esa nota (t=0); los silencios
    // de preparación nunca se suman. No se hace esto con anacrusas.
    let startReferenceCorrectionMs=0;
    if(activeStrictTempoFromTap && activeListeningTempo && Number.isFinite(activeFirstMelodyTime) &&
       Number.isFinite(activeFirstMelodyTick) && activeFirstMelodyTick===measureStartTick(config.fromMeasure)){
      const beat=activeListeningTempo.periodMs;
      const lastTap=activeTapLastOnset;
      if(Number.isFinite(lastTap)){
        const following=lastTap+Math.ceil((activeFirstMelodyTime-lastTap)/beat)*beat;
        const early=following-activeFirstMelodyTime;
        if(early>=0 && early<=beat*ACTIVE_START_ANTICIPATION_BEATS){
          startReferenceCorrectionMs=early;
        }
      }
    }
    if(startReferenceCorrectionMs>0){
      console.log('[RECOGNITION] Inicio anticipado alineado al compás, conservando MIDI original', {anticipacionMs:Math.round(startReferenceCorrectionMs)}); //debug.midi.recognition
    }
    const perMeasure=new Map();
    if(activeSessionMetronomeMode==='flexible'){
      for(let measure=config.fromMeasure;measure<=config.toMeasure;measure++){
        const begin=measureStartTick(measure);
        if(!Number.isFinite(begin))continue;
        const local=uniqueAnchors.filter(a=>a.measure===measure&&Number.isFinite(a.bpm)&&a.bpm>0);
        const bpm=local.length?local[Math.floor(local.length/2)].bpm:(uniqueAnchors.find(a=>a.measure>measure)?.bpm??uniqueAnchors.findLast(a=>a.measure<measure)?.bpm??config.bpm);
        const scale=60000/(Math.max(1,bpm)*ppq);
        const offsetMs=local.length?local.reduce((sum,a)=>sum+a.time-(a.tick-begin)*scale,0)/local.length
          :activeExpectedTimeAtTick(begin,uniqueAnchors,config.bpm,ppq);
        perMeasure.set(measure,{bpm,offsetMs});
      }
    }
    // ESTRICTO conserva un pulso único, no se reancla en cada compás.
    const strictScale=activeListeningTempo?activeListeningTempo.periodMs/ppq:60000/(config.bpm*ppq);
    const strictAnchor=uniqueAnchors[0];
    const strictOrigin=activeStrictTempoFromTap&&Number.isFinite(activeFirstMelodyTime)
      ?activeFirstMelodyTime+startReferenceCorrectionMs-(activeFirstMelodyTick-measureStartTick(config.fromMeasure))*strictScale
      :(strictAnchor?strictAnchor.time-(strictAnchor.tick-measureStartTick(config.fromMeasure))*strictScale:origin);
    expected.events=expected.events.map(e=>{
      const alignment=perMeasure.get(e.measure);
      const onset=activeSessionMetronomeMode==='flexible'&&alignment
        ? alignment.offsetMs+(e.startTick-measureStartTick(e.measure))*60000/(alignment.bpm*ppq)-origin
        :activeSessionMetronomeMode==='strict' ? strictOrigin+(e.startTick-measureStartTick(config.fromMeasure))*strictScale-origin
        :activeExpectedTimeAtTick(e.startTick,uniqueAnchors,config.bpm,ppq)-origin;
      const offset=alignment?onset+(e.endTick-e.startTick)*60000/(alignment.bpm*ppq)
        :activeSessionMetronomeMode==='strict'?onset+(e.endTick-e.startTick)*strictScale
        :activeExpectedTimeAtTick(e.endTick,uniqueAnchors,config.bpm,ppq)-origin;
      return {...e,timeOn:onset,timeOff:Math.max(onset,offset)};
    });
    // La correspondencia de acordes es por orden musical; los tiempos de
    // referencia reconstruidos se emplean DESPUÉS para evaluar desviaciones.
    const consolidated=consolidatePerformance(expected,captured,{alignmentMode:'SEQUENTIAL'});
    const results=consolidateResults(consolidated);
    console.log('[PT PERFORMANCE] Escucha activa, fragmento continuo',{
      inicio:config.fromMeasure,fin:config.toMeasure,manos:[...activeFragmentHands],
      anclas:uniqueAnchors,captured,consolidated,results}); //debug.eval.performance
    renderResults(results);updateEvaluationPresentation(consolidated,results);
  }catch(error){console.error('[ACTIVE] No se pudo evaluar el último fragmento',error);}
}
function scheduleFlexibleStopAfterCurrentMeasure(now,anchor){
  clearActiveFlexStop();
  if(activeMetronomeMode!=='flexible'||activeFlexSuspended||!jsonScore||!anchor)return;
  const ppq=jsonScore.ppq||480;
  const markers=jsonScore.events.filter(e=>e.type==='startOfMeasure').sort((a,b)=>a.startTick-b.startTick);
  const current=[...markers].reverse().find(m=>m.startTick<=anchor.tick);
  const next=markers.find(m=>m.startTick>anchor.tick);
  const beats=current?.beats||4,beatType=current?.beatType||4;
  const endTick=next?.startTick??current?.startTick+beats*ppq*4/beatType;
  const beatMs=60000/anchor.bpm;
  updateFlexMeasureGuard(anchor);
  const measureEndsAt=anchor.time+Math.max(0,endTick-anchor.tick)*beatMs/ppq;
  const grace=Math.max(ACTIVE_FLEX_END_MEASURE_MIN_GRACE_MS,beatMs*ACTIVE_FLEX_END_MEASURE_GRACE_BEATS);
  const delay=Math.max(0,measureEndsAt+grace-now);
  const generation=activeFlexStopGeneration;
  console.log('[RECOGNITION] FLEXIBLE mantiene pulso hasta fin de compás', {compas:current?.measure,esperaMs:Math.round(delay)}); //debug.midi.recognition
  activeFlexStopTimer=setTimeout(()=>{
    if(generation!==activeFlexStopGeneration||!activeListening||activeListeningPaused||
      activeMetronomeMode!=='flexible'||!activeRelocalizing)return;
    // Si el pulso final aún no se ha emitido (reprogramación, latencia o
    // sincronización), NO suspendemos: revisaremos tras el siguiente tick.
    if(activeFlexMeasureGuard&&!activeFlexMeasureGuard.lastBeatEmitted){
      activeFlexStopTimer=setTimeout(()=>{
        if(generation===activeFlexStopGeneration&&activeRelocalizing&&
          activeFlexMeasureGuard?.lastBeatEmitted&&activeMetronomeMode==='flexible'){
          activeFlexSuspended=true;clearActiveTick();
          console.log('[FLEX] Suspensión tras último pulso del compás',activeFlexMeasureGuard.measure); //debug.midi.recognition
        }
      },Math.max(75,beatMs/3));
      return;
    }
    activeFlexSuspended=true;clearActiveTick();
    console.log('[RECOGNITION] FLEXIBLE suspendido tras terminar el compás y margen',current?.measure); //debug.midi.recognition
  },delay);
}
function stopActiveFollow(){if(activeFollowTimer!==null){clearInterval(activeFollowTimer);activeFollowTimer=null;}}
function activeExpectedAttacksAfter(tick){
  if(!jsonScore)return [];
  const staffIds=activeLastConfirmedHand.includes('both')?[1,2]:activeLastConfirmedHand.includes('right')?[1]:activeLastConfirmedHand.includes('left')?[2]:[1,2];
  const ticks=new Set((jsonScore.events||[])
    .filter(e=>e.type==='note'&&staffIds.includes(e.staff)&&e.startTick>tick)
    .map(e=>e.startTick));
  return [...ticks].sort((a,b)=>a-b);
}
function startActiveRelocalization(now,reason){
  if(activeRelocalizing)return;
  activeRelocalizing=true;
  const previousAnchor=activeFollowAnchor;
  activeFollowAnchor=null; // No avanzar por una proyección vieja tras una pausa.
  scheduleFlexibleStopAfterCurrentMeasure(now,previousAnchor);
  activeRecognizer?.enterRelocalization(now);
  activeWaitingMeasure=activeRecognizer?.getProgress().expectedMeasure??activeStartingMeasure;
  const tick=measureStartTick(activeWaitingMeasure);
  if(Number.isFinite(tick))moveScoreCursor(tick,true);
  renderMeasureHighlights();
  console.log('[RECOGNITION] Seguimiento congelado; espera secuencial',reason); //debug.midi.recognition
}
function startActiveFollow(){
  stopActiveFollow();activeFollowTimer=setInterval(()=>{
    if(!activeListening||activeListeningPaused||!jsonScore)return;
    const now=performance.now(),anchor=activeFollowAnchor;
    if(anchor&&!activeRelocalizing){
    const expected=activeExpectedAttacksAfter(anchor.tick);
    const upcoming=expected[0];
    const beatMs=60000/anchor.bpm,ppq=jsonScore.ppq||480;
    const anticipated=Number.isFinite(upcoming)?anchor.time+(upcoming-anchor.tick)*beatMs/ppq
      :anchor.time+ACTIVE_PAUSE_AT_END_BEATS*beatMs;
    const grace=Math.max(ACTIVE_PAUSE_MIN_GRACE_MS,Math.min(ACTIVE_PAUSE_MAX_GRACE_MS,beatMs*ACTIVE_PAUSE_GRACE_BEATS));
    if(now>anticipated+grace && now-(activeLastStudentOn??now)>2400)startActiveRelocalization(now,'Silencio o falta de coincidencia');
    // El cursor SOLO avanza mediante ataques reconocidos, nunca por tiempo.
    }
    if(activeMetronomeMode==='strict'&&activeStrictTempoLocked&&activeMelodyStarted&&
       activeFragmentConfirmed&&!activeAutoStopping&&activeHeldKeys.size===0&&
       Number.isFinite(activeLastMusicalAttackTime)&&activeListeningTempo){
      const currentMeasure=activeWaitingMeasure??activeFragmentLastMeasure;
      const marker=(jsonScore.events??[]).filter(e=>e.type==='startOfMeasure'&&e.measure<=currentMeasure).at(-1);
      const beats=(Number(marker?.beats)||4)*4/(Number(marker?.beatType)||4);
      const barMs=beats*activeListeningTempo.periodMs;
      const pending=(jsonScore.events??[]).some(e=>e.type==='note'&&e.measure===currentMeasure);
      if(pending&&now-activeLastMusicalAttackTime>=barMs){
        activeAutoStopping=true;
        console.log('[RECOGNITION] STOP automático: compás completo de inactividad en modo ESTRICTO'); //debug.midi.recognition
        deactivateActiveListening().catch(console.error);
      }
    }
  },ACTIVE_FOLLOW_STEP_MS);
}
function clearActiveTick(){if(activeTickTimeout!==null){clearTimeout(activeTickTimeout);activeTickTimeout=null;}}
function clearActiveTap(){activeLog('Reinicio de secuencia', {nota:activeTapPitch,confirmados:activeTapTimes.length,pendientes:activeTapDown.size});activeTapPitch=null;activeTapTimes=[];activeTapDown.clear();}
function showActiveListeningStatus(){
  if(!activeListening)return;
  if(activeListeningPaused){setTransportStatus('paused','PAUSADO');updateActiveMetronomeIndicator();return;}
  setTransportStatus('recording','ESCUCHA ACTIVA');updateActiveMetronomeIndicator();
}
function scheduleActiveTick(delayMs){
  clearActiveTick();if(!activeListening||activeListeningPaused||!activeListeningTempo||!activeMeterRunning())return;
  const delay=Math.max(0,delayMs);
  activeNextTickAt=performance.now()+delay;
  activeLog('Tick automático programado', {esperaMs:Math.round(delay),pitch:activeListeningTempo.pitch});
  activeTickTimeout=setTimeout(()=>{
    activeTickTimeout=null;
    if(!activeListening||activeListeningPaused||!activeListeningTempo||!activeMeterRunning())return;
    const scheduledTime=activeNextTickAt;
    const sent=sendLiveMetronomeNote(activeListeningTempo.pitch,ACTIVE_METRONOME_VELOCITY,ACTIVE_METRONOME_DURATION_MS);
    if(activeMetronomeMode==='flexible')registerFlexBeatEmitted(scheduledTime);
    activeLog('MIDI OUT tick automático', {pitch:activeListeningTempo.pitch,velocity:ACTIVE_METRONOME_VELOCITY,enviado:sent,modo:activeMetronomeMode});
    showActiveListeningStatus();
    // Evitar deriva: usamos el vencimiento teórico, no el instante del callback.
    const next=activeNextTickAt+activeListeningTempo.periodMs;
    scheduleActiveTick(Math.max(0,next-performance.now()));
  },delay);
}
function activeMidiInput(data,time){
  const [status=0,pitch=0,velocity=0]=data??[];
  const command=status&0xf0,channel=status&15;
  const type=command===0x90?(velocity>0?'NOTE_ON':'NOTE_ON velocidad 0 (OFF)'):command===0x80?'NOTE_OFF':'OTRO';
  if(type!=='OTRO')activeLog('MIDI IN', {type,pitch,velocity,channel,t:Math.round(time),modoActivo:activeListening,pausado:activeListeningPaused,tempoDetectado:!!activeListeningTempo});
  if(activeListening && !activeListeningPaused && pitch<ACTIVE_TAP_MIN_PITCH &&
     (command===0x80 || command===0x90)){
    const isOn=command===0x90&&velocity>0;
    const event={type:isOn?'noteOn':'noteOff',pitch,velocity,channel,time};
    // Conservamos todos los eventos interpretados (incluidos sus OFF) para
    // reconstruir posteriormente la interpretación y las duraciones reales.
    activeCapturedEvents.push(event);
    const heldKey=`${channel}:${pitch}`;
    if(isOn){activeHeldKeys.add(heldKey);activeLastMusicalAttackTime=time;}
    else activeHeldKeys.delete(heldKey);
    if(isOn){
      // Sólo un ataque asignado a la partitura inicia la interpretación; las
      // pulsaciones C7+ ni el tiempo de espera cuentan para evaluación.
      activeRecognizer?.feed(event);
    }
  }
  if(!activeListening||activeListeningPaused){
    if(type!=='OTRO')activeLog('Ignorado: escucha desactivada, pausada o metrónomo ya iniciado');
    return;
  }
  if(pitch<ACTIVE_TAP_MIN_PITCH||pitch>127){
    if(type!=='OTRO')activeLog('Ignorado: nota inferior a C7', {pitch,minimo:ACTIVE_TAP_MIN_PITCH});
    return;
  }
  const key=`${channel}:${pitch}`;
  if(command===0x90&&velocity>0){
    if(activeTapDown.has(key))activeLog('Aviso: NOTE_ON repetido sin NOTE_OFF', {key});
    activeTapDown.set(key,time);
    activeLog('Ataque registrado; esperando liberación', {key});
    return;
  }
  if(command!==0x80&&!(command===0x90&&velocity===0))return;
  const onset=activeTapDown.get(key);activeTapDown.delete(key);
  if(!Number.isFinite(onset)){
    activeLog('Descartado: NOTE_OFF sin NOTE_ON previo', {key});return;
  }
  const duration=time-onset;
  if(duration>=ACTIVE_TAP_MAX_DURATION_MS||duration<0){
    activeLog('Descartado: pulsación fuera del límite', {pitch,duracionMs:Math.round(duration),maxExclusivoMs:ACTIVE_TAP_MAX_DURATION_MS});return;
  }
  activeLog('Tick válido', {pitch,duracionMs:Math.round(duration)});
  if(activeTapPitch!==pitch){
    activeLog('Cambio de nota de referencia; nueva secuencia', {anterior:activeTapPitch,nueva:pitch});
    activeTapPitch=pitch;activeTapTimes=[];
  }
  if(activeTapTimes.length>0){
    const gap=onset-activeTapTimes.at(-1);
    if(gap<100||gap>3000){
      activeLog('Intervalo fuera de rango: reinicio de secuencia', {intervaloMs:Math.round(gap),minMs:100,maxMs:3000});
      activeTapTimes=[];
    }else activeLog('Intervalo admitido', {intervaloMs:Math.round(gap)});
  }
  activeTapTimes.push(onset);
  const beats=activeMeasureBeats();
  activeLog('Progreso de detección', {confirmados:activeTapTimes.length,necesarios:beats,pitch:activeTapPitch});
  if(activeTapTimes.length<beats)return;
  const intervals=activeTapTimes.slice(1).map((t,i)=>Math.round(t-activeTapTimes[i]));
  const periodMs=(activeTapTimes.at(-1)-activeTapTimes[0])/(activeTapTimes.length-1);
  const bpm=Math.round(60000/periodMs);
  activeLog('Secuencia completa', {intervalosMs:intervals,periodoMs:Math.round(periodMs),bpm,limitesBpm:[ACTIVE_MIN_BPM,ACTIVE_MAX_BPM]});
  if(!Number.isFinite(periodMs)||bpm<ACTIVE_MIN_BPM||bpm>ACTIVE_MAX_BPM){
    activeLog('Secuencia rechazada: tempo fuera de rango');clearActiveTap();return;
  }
  // La secuencia C7+ fija permanentemente tempo y fase del ESTRICTO.
  // No cambia el modo: únicamente M modifica esa preferencia.
  activeTapLastOnset=onset;activeMeasuredBpm=bpm;activeListeningTempo={pitch,periodMs};activeLastTickPitch=pitch;
  activeStrictTempoLocked=true;activeStrictTempoFromTap=true;activeFlexSuspended=true;
  bpmInput.value=String(bpm);lessonDirty=true;saveLessonPreference(lessonFromControls());updateActiveMetronomeIndicator();
  clearActiveTap();
  // Primer pulso automático un período después del último ataque manual.
  const delay=Math.max(0,onset+periodMs-performance.now());
  activeLog('Tempo establecido; arrancando metrónomo', {pitch,bpm,primerTickEnMs:Math.round(delay)});
  if(activeMetronomeMode==='strict')scheduleActiveTick(delay);
}

async function deactivateActiveListening(){
  activeLog('Desactivación de escucha activa', {eventosCapturados:activeCapturedEvents.length,reconocimiento:activeRecognizer?.getProgress()});
  if(activeListening)evaluateActiveFragment();
  clearActiveFlexStop();resetActiveFragment();
  activeInitialVisitedMeasures.clear();
  activeListening=false;activeListeningPaused=false;activeListeningTempo=null;activeStrictTempoLocked=false;activeStrictTempoFromTap=false;activeRecognizer=null;activeFullExpectedPerformance=null;activeFlexMeasureGuard=null;stopActiveFollow();activeFollowAnchor=null;activeRelocalizing=false;activeFlexSuspended=true;
  clearActiveTick();clearActiveTap();activeRemainingToTick=null;activeNextTickAt=null;
  activeListeningSwitch.checked=false;activeWaitingMeasure=null;updateActiveMetronomeIndicator();renderMeasureHighlights();
  setMidiInputObserver(null);
  await stopMidiSession();
  setPlaybackState(PT_PLAYBACK_STATE.STOPPED);updateMidiControls();
}
async function activateActiveListening(){
  if(activeListening)return;
  activeLog('Solicitud de activación', {midiIn:midiIn.value,midiOut:midiOut.value});
  if(!midiIn.value||!midiOut.value){activeListeningSwitch.checked=false;alert('Escucha activa necesita MIDI IN y MIDI OUT seleccionados.');return;}
  await fullStop();
  try{
    await openSelectedMidiPorts('escucha activa');
    activeInitialVisitedMeasures.clear();
    activeListening=true;activeSessionMetronomeMode=activeMetronomeMode;activeLastMusicalAttackTime=null;activeHeldKeys.clear();activeAutoStopping=false;activeListeningPaused=false;activeListeningTempo=null;activeMeasuredBpm=null;activeStartingMeasure=Number(fromInput.value)||1;activeWaitingMeasure=activeStartingMeasure;activeStrictTempoLocked=false;activeStrictTempoFromTap=false;activeTapLastOnset=null;activeFlexSuspended=true;activeFlexMeasureGuard=null;activeFollowAnchor=null;activeFollowBpm=null;activeLastStudentOn=null;activeExpectedMeasure=null;activeRelocalizing=false;activeLastConfirmedHand=[];clearActiveTap();startActiveFollow();
    resetActiveFragment();clearActiveFlexStop();
    prepareFullActiveReference();
    moveScoreCursor(measureStartTick(activeStartingMeasure),true);
    showEvaluationMeasureBackgrounds=false;renderMeasureHighlights();
    moveScoreCursor(measureStartTick(activeStartingMeasure),true);
    keepActiveCursorAboveHighlights();
    setMidiInputObserver(activeMidiInput);activeListeningSwitch.checked=true;updateActiveMetronomeIndicator();
    activeLog('Escucha activada; observador registrado', {dispositivo:midiIn.value,beatsNecesarios:activeMeasureBeats(),notaMinima:ACTIVE_TAP_MIN_PITCH,duracionMaximaMs:ACTIVE_TAP_MAX_DURATION_MS});
    showActiveListeningStatus();updateMidiControls();
  }catch(error){activeLog('Error al activar escucha',error);activeListeningSwitch.checked=false;setMidiInputObserver(null);await releaseMidiIfIdle();alert(error.message);console.error(error);}
}
function shiftActiveStartingMeasure(delta){
  if(!activeListening||activeListeningPaused||activeMelodyStarted||activeFragmentConfirmed||!jsonScore)return false;
  const next=Math.max(1,Math.min(jsonScore.measures,activeStartingMeasure+delta));
  if(next===activeStartingMeasure)return true;
  activeInitialVisitedMeasures.add(activeStartingMeasure);
  activeStartingMeasure=next;
  activeWaitingMeasure=next;
  activeExpectedMeasure=null;
  activeRelocalizing=false;
  activeFollowAnchor=null;
  activeLastConfirmedHand=[];
  fromInput.value=String(next);
  if(Number(toInput.value)<next)toInput.value=String(next);
  syncMeasureInputBounds();
  lessonDirty=true;
  saveLessonPreference(lessonFromControls());
  // La referencia musical completa es inmutable. Solo rearmamos el reconocedor.
  initializeActiveRecognizer(next);
  const tick=measureStartTick(next);
  if(Number.isFinite(tick))moveScoreCursor(tick,true);
  renderMeasureHighlights();
  keepActiveCursorAboveHighlights();
  return true;
}
function toggleActiveListeningPause(){
  if(!activeListening)return false;
  activeLog('Conmutación pausa/reanudación', {estabaPausado:activeListeningPaused,tempoDetectado:!!activeListeningTempo});
  if(!activeListeningPaused){
    clearActiveFlexStop();
    activeListeningPaused=true;
    activeRecognizer?.enterRelocalization(performance.now());
    activeWaitingMeasure=activeRecognizer?.getProgress().expectedMeasure??activeStartingMeasure;
    const waitTick=measureStartTick(activeWaitingMeasure);
    if(Number.isFinite(waitTick))moveScoreCursor(waitTick,true);
    activeFollowAnchor=null;activeRelocalizing=true;
    renderMeasureHighlights();
    activeRemainingToTick=activeMeterRunning()&&activeListeningTempo?Math.max(0,(activeNextTickAt??performance.now())-performance.now()):null;
    clearActiveTick();showActiveListeningStatus();
  }else{
    activeRecognizer?.enterRelocalization(performance.now());
    showEvaluationMeasureBackgrounds=false;renderMeasureHighlights();
    activeListeningPaused=false;showActiveListeningStatus();
    if(activeMetronomeMode==='strict'&&activeListeningTempo)scheduleActiveTick(activeRemainingToTick??activeListeningTempo.periodMs);
    activeRemainingToTick=null;
  }
  return true;
}

function activeRecognizedMeasure(result){
  if(!activeListening||!jsonScore)return;
  clearActiveFlexStop();
  // El segmento evaluable empieza siempre en el compás inicial configurado.
  // Nunca se descarta por pérdida de seguimiento o pausa.
  if(!activeFragmentConfirmed){
    activeFragmentStartTime??=activeCapturedEvents.find(e=>e.type==='noteOn')?.time??result.segmentStartTime??result.lastTime;
    activeFragmentFirstMeasure=activeStartingMeasure;
    activeFragmentLastMeasure=result.measure;
    activeFragmentConfirmed=true;
  }else activeFragmentLastMeasure=Math.max(activeFragmentLastMeasure,result.measure);
  activeWaitingMeasure=result.expectedMeasure<=jsonScore.measures?result.expectedMeasure:null;
  if(result.bpm)activeMeasuredBpm=result.bpm;
  if(result.hand==='both'){activeFragmentHands.add('right');activeFragmentHands.add('left');}
  else activeFragmentHands.add(result.hand);
  activeExpectedMeasure=result.expectedMeasure;
  activeRelocalizing=false;
  activeLastConfirmedHand=result.hand==='both'?['both']:[result.hand];
  if(Number.isFinite(result.lastTick)&&Number.isFinite(result.lastTime)){
    activeRecognizedTick=result.lastTick;
    const bpm=result.bpm||activeFollowBpm||Number(bpmInput.value)||80;
    activeFollowBpm=bpm;
    activeFragmentAnchors.push({measure:result.measure,tick:result.lastTick,time:result.lastTime,bpm});
    activeFollowAnchor={tick:result.lastTick,time:result.lastTime,bpm};
    activeLastStudentOn=performance.now();
    moveScoreCursor(result.lastTick,true);
    if(activeMetronomeMode==='strict'&&!activeStrictTempoLocked && result.bpm){
      activeStrictTempoLocked=true;
      activeListeningTempo={pitch:activeLastTickPitch,periodMs:60000/result.bpm};
      const beatTick=jsonScore.ppq||480;
      const nextBeat=Math.floor(result.lastTick/beatTick+1)*beatTick;
      const delay=Math.max(0,(nextBeat-result.lastTick)*60000/(result.bpm*beatTick)-(performance.now()-result.lastTime));
      scheduleActiveTick(delay);
    }
    if(activeMetronomeMode==='flexible'&&result.confidence>=ACTIVE_FLEX_CONFIDENCE){
      activeFlexSuspended=false;
      updateFlexMeasureGuard({tick:result.lastTick,time:result.lastTime,bpm});
      const ppq=jsonScore.ppq||480,beatTicks=ppq;
      const nextBeat=Math.floor(result.lastTick/beatTicks+1)*beatTicks;
      const wait=Math.max(0,(nextBeat-result.lastTick)*60000/(bpm*ppq)-(performance.now()-result.lastTime));
      activeListeningTempo={pitch:activeLastTickPitch,periodMs:60000/bpm};
      scheduleActiveTick(wait);
      activeLog('FLEXIBLE resincronizado',{bpm,proximoTick:nextBeat,esperaMs:Math.round(wait)});
    }
  }
  const maxMeasure=jsonScore.measures;
  const start=Math.max(1,Math.min(maxMeasure,activeStartingMeasure));
  const end=Math.max(Number(toInput.value),Math.min(maxMeasure,activeFragmentLastMeasure));
  fromInput.value=String(start);toInput.value=String(end);
  if(result.bpm && !activeStrictTempoLocked)bpmInput.value=String(result.bpm);
  updateActiveMetronomeIndicator();
  recordRightInput.checked=result.hands.includes('right');
  recordLeftInput.checked=result.hands.includes('left');
  syncMeasureInputBounds();updateAccompanyControls();
  // No llamamos a markLessonDirty: detendría una sesión en curso.
  lessonDirty=true;
  saveLessonPreference(lessonFromControls());
  renderMeasureHighlights();

  console.log('[RECOGNITION] Configuración actualizada', {inicio:start,fin:end,bpm:result.bpm,manos:result.hands,esperado:result.expectedMeasure}); //debug.midi.recognition
}
function activeRecognitionProgress(result){
  if(!activeListening||activeListeningPaused)return;
  if(Number.isFinite(result.provisionalTick)&&Number.isFinite(result.provisionalTime)){
    const bpm=result.bpm||activeFollowBpm||Number(bpmInput.value)||80;
    activeWaitingMeasure=result.expectedMeasure;
    if(!activeMelodyStarted){
      activeMelodyStarted=true;activeSessionMetronomeMode=activeMetronomeMode;
      activeFirstMelodyTime=result.provisionalTime;
      activeFirstMelodyTick=result.provisionalTick;
      activeFragmentStartTime=result.provisionalTime;
      console.log('[RECOGNITION] Comienza interpretación musical', {compas:result.expectedMeasure,tick:result.provisionalTick}); //debug.midi.recognition
    }
    activeRelocalizing=false;
    activeFollowAnchor={tick:result.provisionalTick,time:result.provisionalTime,bpm};
    // Las anclas de ataque permiten al evaluador reanclar el tiempo después
    // de una pausa sin trasladar el silencio al siguiente compás.
    if(result.bpm && !activeFragmentAnchors.some(a=>a.tick===result.provisionalTick&&a.time===result.provisionalTime)){
      activeFragmentAnchors.push({measure:result.expectedMeasure,tick:result.provisionalTick,time:result.provisionalTime,bpm});
    }
    activeLastStudentOn=performance.now();
    moveScoreCursor(result.provisionalTick,true);
    if(result.bpm){
      activeMeasuredBpm=result.bpm;updateActiveMetronomeIndicator();
      if(activeMetronomeMode==='strict'&&!activeStrictTempoLocked){
        activeStrictTempoLocked=true;
        activeListeningTempo={pitch:activeLastTickPitch,periodMs:60000/result.bpm};
        const ppq=jsonScore.ppq||480;
        const nextBeat=Math.floor(result.provisionalTick/ppq+1)*ppq;
        const delay=Math.max(0,(nextBeat-result.provisionalTick)*60000/(result.bpm*ppq)-(performance.now()-result.provisionalTime));
        scheduleActiveTick(delay);
      }
      if(activeMetronomeMode==='flexible'&&activeFlexSuspended&&result.confidence>=ACTIVE_FLEX_CONFIDENCE){
        activeFlexSuspended=false;
        activeListeningTempo={pitch:activeLastTickPitch,periodMs:60000/result.bpm};
        updateFlexMeasureGuard({tick:result.provisionalTick,time:result.provisionalTime,bpm:result.bpm});
        const ppq=jsonScore.ppq||480,beatTick=ppq;
        const nextBeat=Math.floor(result.provisionalTick/beatTick+1)*beatTick;
        const delay=Math.max(0,(nextBeat-result.provisionalTick)*60000/(result.bpm*ppq)-(performance.now()-result.provisionalTime));
        scheduleActiveTick(delay);
      }
    }
    renderMeasureHighlights();
    requestAnimationFrame(()=>{if(activeListening&&osmd?.cursor){setCursorAppearance(false);osmd.cursor.show();}});
  }
}
function toggleActiveMetronome(){
  if(!activeListening)return;
  const modes=['off','flexible','strict'];
  const previousMode=activeMetronomeMode;
  activeMetronomeMode=modes[(modes.indexOf(activeMetronomeMode)+1)%3];
  persistMetronomeMode();
  // M sólo modifica la preferencia. No fabrica un BPM ni arranca el reloj.
  // Los ticks en curso obedecen al nuevo modo; si la interpretación ya
  // estableció tempo/fase, esa información se conserva sin reiniciarla.
  if(activeMetronomeMode==='strict' && previousMode==='flexible' && activeTickTimeout!==null && activeMeasuredBpm && activeMelodyStarted && !activeStrictTempoFromTap){
    activeStrictTempoLocked=true;
    activeListeningTempo={pitch:activeLastTickPitch,periodMs:60000/activeMeasuredBpm};
  }
  if(activeMetronomeMode==='flexible' && activeFollowAnchor?.bpm){
    activeFlexSuspended=false;
    activeListeningTempo={pitch:activeLastTickPitch,periodMs:60000/activeFollowAnchor.bpm};
  }
  // Con M no se crean nuevos timers: si el metrónomo ya estaba
  // emitiendo ticks continúa con la misma fase; si no, arranca cuando
  // el reconocedor obtiene evidencia musical o se marca C7+.
  if(!activeMeterRunning())clearActiveTick();
  activeLog('Modo de metrónomo',activeMetronomeMode);showActiveListeningStatus();
}
activeMetronomeButton?.addEventListener('click',toggleActiveMetronome);
updateActiveMetronomeIndicator();

activeListeningSwitch.addEventListener('change',async()=>{
  if(activeListeningSwitch.checked)await activateActiveListening();else await deactivateActiveListening();
});
window.addEventListener('keydown',async event=>{
  if(isEditableTarget(event.target))return;
  const plain=!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey;
  if(plain&&event.code==='Space'){event.preventDefault();leaveEditMode();if(activeListening){toggleActiveListeningPause();return;}playButton.click();return;}
  if(plain&&event.key==='Escape'){event.preventDefault();leaveEditMode();if(activeListening){await deactivateActiveListening();return;}await keyboardStop();return;}
  if(plain&&event.key.toLowerCase()==='a'){event.preventDefault();leaveEditMode();if(!activeListening)await activateActiveListening();return;}
  if(activeListening){
    if(plain&&event.key.toLowerCase()==='m'){event.preventDefault();toggleActiveMetronome();return;}
    if(plain&&(event.key==='ArrowLeft'||event.key==='ArrowRight')&&!activeMelodyStarted&&!activeFragmentConfirmed){
      event.preventDefault();shiftActiveStartingMeasure(event.key==='ArrowLeft'?-1:1);return;
    }
    return;
  }
  if(plain&&event.key==='Home'){event.preventDefault();leaveEditMode();restartButton.click();return;}
  if(plain&&event.key.toLowerCase()==='g'){event.preventDefault();leaveEditMode();await setModeAndStart('evaluate');return;}
  if(plain&&event.key.toLowerCase()==='e'){event.preventDefault();leaveEditMode();await setModeAndStart('listen');return;}
  if(plain&&event.key.toLowerCase()==='r'){event.preventDefault();leaveEditMode();await startRepeatWorkflow();return;}
  if(event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
    event.preventDefault();leaveEditMode();(event.key==='ArrowLeft'?previousMeasureButton:nextMeasureButton).click();return;
  }
  if(plain&&event.key==='ArrowLeft'){event.preventDefault();enterEditAtAdjacentNote(-1);return;}
  if(plain&&event.key==='ArrowRight'){event.preventDefault();enterEditAtAdjacentNote(1);return;}
  if(plain&&event.key==='ArrowUp'){event.preventDefault();if(!showEvaluationMeasureBackgrounds)enterEditOnStaff(1);return;}
  if(plain&&event.key==='ArrowDown'){event.preventDefault();if(!showEvaluationMeasureBackgrounds)enterEditOnStaff(2);return;}
  if(plain&&(event.key.toLowerCase()==='i'||event.key.toLowerCase()==='f')){
    event.preventDefault();leaveEditMode();setCurrentMeasureShortcut(event.key.toLowerCase()==='i'?fromInput:toInput);return;
  }
  if(plain&&editMode&&!reviewMode&&!showEvaluationMeasureBackgrounds&&/^[1-6]$/.test(event.key)){event.preventDefault();await editSelectedFingering(Number(event.key));return;}
  if(plain&&editMode&&!reviewMode&&!showEvaluationMeasureBackgrounds&&event.key.toLowerCase()==='m'){event.preventDefault();await cycleSelectedMordent();return;}
  if(editMode)leaveEditMode();
});
// Cualquier interacción de interfaz distinta de las flechas simples abandona
// la selección individual. Los botones de transporte ya hacen lo mismo.
document.addEventListener('pointerdown',event=>{if(editMode&&!event.target.closest('#score'))leaveEditMode();},{capture:true});

followScoreInput.addEventListener('change',configureScoreFollowing);
for(const button of asideButtons) button.addEventListener('click',()=>setAsideView(button.dataset.asideView));
window.addEventListener('resize',configureWorkspace);
configureWorkspace();
panicButton.addEventListener('click',()=>{if(activeListening){deactivateActiveListening().catch(console.error);return;}fullStop().catch(error=>{console.error(error);alert(error.message);});});

function fillSelect(select,ports,kind){select.innerHTML='';if(!ports.length){select.add(new Option(`— Sin dispositivo MIDI ${kind} —`,''));select.disabled=true;return;}select.disabled=false;for(const p of ports)select.add(new Option(p.name||p.manufacturer||p.id,p.id));}
function storedMidiPreference(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function saveMidiPreference(key,port){try{if(port)localStorage.setItem(key,JSON.stringify({id:port.id,name:port.name??'',manufacturer:port.manufacturer??''}));}catch(error){console.warn('[STORAGE] No se pudo guardar la preferencia MIDI:',error);}}
function matchingPort(ports,saved){if(!saved)return null;return ports.find(p=>p.id===saved.id)||ports.find(p=>p.name===saved.name&&(!saved.manufacturer||p.manufacturer===saved.manufacturer))||null;}
function updateMidiControls(){
  const hasIn=Boolean(midiIn.value)&&midiIn.options.length>0,hasOut=Boolean(midiOut.value)&&midiOut.options.length>0;
  const active=isMidiContextActive();
  midiIn.disabled=!hasIn||active;
  midiOut.disabled=!hasOut||active;
  midiThruInput.disabled=!(hasIn&&hasOut);
  if(midiThruInput.disabled)midiThruInput.checked=false;
  refreshMidiButton.disabled=active;
}
function applyDiscoveredMidiDevices({notifyMissing=false}={}){
  const ins=getMidiInputs(),outs=getMidiOutputs();
  const savedIn=storedMidiPreference(STORAGE_MIDI_IN),savedOut=storedMidiPreference(STORAGE_MIDI_OUT);
  const matchedIn=matchingPort(ins,savedIn),matchedOut=matchingPort(outs,savedOut);
  const selectedIn=matchedIn??ins[0]??null,selectedOut=matchedOut??outs[0]??null;
  const warnings=[];
  if(notifyMissing&&savedIn&&!matchedIn)warnings.push(`El dispositivo MIDI IN guardado «${savedIn.name||savedIn.id}» ya no está disponible.${selectedIn?` Se utilizará «${selectedIn.name||selectedIn.id}».`:' No hay otro MIDI IN disponible.'}`);
  if(notifyMissing&&savedOut&&!matchedOut)warnings.push(`El dispositivo MIDI OUT guardado «${savedOut.name||savedOut.id}» ya no está disponible.${selectedOut?` Se utilizará «${selectedOut.name||selectedOut.id}».`:' No hay otro MIDI OUT disponible.'}`);
  fillSelect(midiIn,ins,'IN');fillSelect(midiOut,outs,'OUT');
  if(selectedIn){midiIn.value=selectedIn.id;setInputDevice(selectedIn.id);saveMidiPreference(STORAGE_MIDI_IN,selectedIn);}else setInputDevice('');
  if(selectedOut){midiOut.value=selectedOut.id;setOutputDevice(selectedOut.id);saveMidiPreference(STORAGE_MIDI_OUT,selectedOut);}else setOutputDevice('');
  updateMidiControls();
  if(warnings.length)alert(warnings.join('\n\n'));
}
async function setupMidi(){
  const ok=await initMidi();
  if(!ok){fillSelect(midiIn,[],'IN');fillSelect(midiOut,[],'OUT');updateMidiControls();return;}
  applyDiscoveredMidiDevices({notifyMissing:true});
}
async function refreshMidi(){
  if(isMidiContextActive())return;
  refreshMidiButton.disabled=true;
  try{await refreshMidiDevices();applyDiscoveredMidiDevices({notifyMissing:true});}
  catch(error){alert(error.message);console.error(error);}
  finally{updateMidiControls();}
}
midiIn.addEventListener('change',()=>{const port=setInputDevice(midiIn.value);saveMidiPreference(STORAGE_MIDI_IN,port);updateMidiControls();});
midiOut.addEventListener('change',()=>{const port=setOutputDevice(midiOut.value);saveMidiPreference(STORAGE_MIDI_OUT,port);updateMidiControls();});
refreshMidiButton.addEventListener('click',refreshMidi);
midiThruInput.addEventListener('change',async()=>{
  const enabled=midiThruInput.checked;
  if(enabled&&!thruWarningShown){
    thruWarningShown=true;
    alert('MIDI THRU mantendrá activo el sistema MIDI para que puedas escuchar el teclado mientras practicas. Un uso prolongado puede aumentar el consumo de recursos del equipo. El sistema MIDI se apagará automáticamente tras 60 segundos de inactividad.');
  }
  try{await setMidiThru(enabled);}
  catch(error){midiThruInput.checked=false;alert(error.message);console.error(error);}
  updateMidiControls();
});
setMidiAutoStopCallback(()=>{
  midiThruInput.checked=false;
  setPlaybackState(PT_PLAYBACK_STATE.STOPPED);
  updateMidiControls();
  console.log('[MIDI] STOP automático tras 60 s de inactividad MIDI THRU.');
});

function setRepertoireMenuOpen(open){repertoirePieceMenu.hidden=!open;repertoirePieceTrigger.setAttribute('aria-expanded',String(open));}
async function selectRepertoirePiece(piece){
  if(!piece?.musicXmlUrl)return;
  selectedRepertoirePieceId=piece.id??null;
  repertoireCurrentTitle.textContent=piece.title||piece.id||'Sin título';
  repertoireCurrentMeta.textContent=[piece.composer,piece.period].filter(Boolean).join(' · ');
  for(const item of repertoirePieceMenu.querySelectorAll('.repertoire-piece-option'))item.classList.toggle('selected',item.dataset.pieceId===selectedRepertoirePieceId);
  const lessons=Array.isArray(piece.lessons)?piece.lessons:[];
  repertoireLessons.textContent=lessons.length?`${lessons.length} lección${lessons.length===1?'':'es'} disponible${lessons.length===1?'':'s'}.`:'No hay lecciones configuradas todavía.';
  setRepertoireMenuOpen(false);repertoirePieceTrigger.disabled=true;
  try{
    await loadMusicXMLFromUrl(piece.musicXmlUrl);
    const title=piece.title||piece.id||'Sin título';
    const rest=[piece.composer,piece.period].filter(Boolean).join(' · ');
    metadataOutput.innerHTML=`<strong>${title}</strong>${rest?` · ${rest}`:''}`;
    metadataOutput.title=[title,piece.composer,piece.period].filter(Boolean).join(' · ');
  }
  catch(error){alert(`No se pudo cargar «${piece.title||piece.id}».\n\n${error.message}`);console.error('[REPERTOIRE] Error al cargar pieza:',error);}
  finally{repertoirePieceTrigger.disabled=false;}
}
function renderRepertoire(){
  repertoirePieceMenu.innerHTML='';
  const pieces=Array.isArray(repertoire?.pieces)?repertoire.pieces:[];
  repertoireStatus.textContent=pieces.length?`${pieces.length} pieza${pieces.length===1?'':'s'} disponible${pieces.length===1?'':'s'}.`:'No hay piezas disponibles.';
  repertoirePieceTrigger.disabled=!pieces.length;
  for(const piece of pieces){
    const button=document.createElement('button');button.type='button';button.className='repertoire-piece-option';button.dataset.pieceId=piece.id??'';button.setAttribute('role','option');
    const title=document.createElement('span');title.className='repertoire-piece-title';title.textContent=piece.title||piece.id||'Sin título';
    const meta=document.createElement('span');meta.className='repertoire-piece-meta';meta.textContent=[piece.composer,piece.period].filter(Boolean).join(' · ');
    button.append(title,meta);button.addEventListener('click',()=>selectRepertoirePiece(piece));repertoirePieceMenu.append(button);
  }
}
repertoirePieceTrigger.addEventListener('click',()=>setRepertoireMenuOpen(repertoirePieceMenu.hidden));
document.addEventListener('click',event=>{if(!repertoirePieces.contains(event.target))setRepertoireMenuOpen(false);});

async function loadRepertoire(){
  try{
    const response=await fetch(REPERTOIRE_URL,{cache:'no-cache'});
    if(!response.ok)throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const data=await response.json();
    if(!data||!Array.isArray(data.pieces))throw new Error('El catálogo no contiene un array «pieces».');
    repertoire=data;renderRepertoire();
  }catch(error){
    repertoire={pieces:[]};repertoirePieceMenu.innerHTML='';repertoirePieceTrigger.disabled=true;repertoireStatus.textContent='No se pudo cargar el repertorio.';repertoireLessons.textContent='';
    console.error('[REPERTOIRE] No se pudo cargar repertoire.json:',error);
  }
}

async function restoreRecentScore(){const recent=await getRecentScore();if(recent?.xml)await loadMusicXML(recent.xml,recent.name||'',false);}
setAsideView('repertoire');
setupMidi();
loadRepertoire();
restoreRecentScore();
