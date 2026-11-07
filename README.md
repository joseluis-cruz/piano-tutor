# Piano Tutor v0.79

Aplicación web local para cargar MusicXML, visualizarlo con OSMD, reproducirlo por Web MIDI y capturar interpretaciones MIDI del alumno.


## Novedades v0.79

- Revisión con mano, nota o acorde escrito y detalle del error; omisiones completas y parciales diferenciadas.
- Panel informativo de edición y revisión más compacto, con texto centrado.
- Cursor de Escucha activa visible sobre el último ataque mientras espera el siguiente compás; cierre correcto de acordes en una o dos manos.
- Flechas para borrar y repetir compases en OFF y FLEXIBLE; suspenden el metrónomo flexible al navegar y permiten avanzar de nuevo entre los compases borrados.
- Limpieza de evaluación al cambiar de pieza o movimiento, o pulsar STOP estando parado; gris claro para la mano no evaluada.
- Selector de metrónomo siempre habilitado mediante botón o `M`; edición de mordentes mediante `Mayús+M`.
- Trazas de consola limitadas a `?debug=true`; el botón Depurar sustituye a Ocultar y abre un panel independiente de desarrollo.


## Novedades v0.78

- Mensajes de duración basados en la figura MusicXML escrita, con interpretación redondeada a la figura musical más cercana a partir de la razón real/esperada del compás.
- Errores de adelanto/retraso expresados como «Te has adelantado/retrasado el tiempo equivalente a una [figura]».
- Cursor OSMD sincronizado con los ataques reconocidos, sin depender del temporizador de confirmación del compás.
- Umbrales de duración conservados: menos del 55 % o más del 180 %.

- OFF: oculta y omite evaluación de Tempo y Duración.
- FLEXIBLE: estima por compás su BPM y offset propios, sin castigar pausas ni cambios de velocidad entre compases.
- ESTRICTO: parada automática tras un compás completo sin nuevos ataques cuando había música pendiente, nunca antes del primer ataque.
- Estadísticas de Tempo y Duración calculadas con los mismos umbrales que generan errores en partitura.
- REVISIÓN: flechas horizontales recorren errores evaluados; quedan bloqueadas las ediciones musicales mientras se revisa.
- Puntos SVG rojos para notas MIDI inesperadas, sin modificar MusicXML, incluidos en navegación.

## Novedades v0.73

- La puntuación global procede de los mismos numeradores y denominadores por compás, ponderados por número de notas. Todos los ataques inesperados se adscriben a un compás para evitar discrepancias invisibles.
- El modo del metrónomo (OFF/FLEXIBLE/ESTRICTO) se conserva en `localStorage` (`pt_metronome_mode`), sin reiniciarse al entrar o salir de Escucha activa.
- Cambiar el modo con `M` no fabrica ticks ni impone un tempo provisional. Un metrónomo ESTRICTO sin marcación previa se arranca cuando el reconocimiento proporciona BPM fiable.
- Las pulsaciones C7+ breves establecen el tempo/fase definitivos del metrónomo ESTRICTO sin iniciar la evaluación ni cambiar el modo seleccionado; ese BPM no se sobrescribe con la melodía.
- El silencio anterior al primer ataque musical queda fuera de la evaluación. Si ese ataque está escrito en el inicio de compás y llega ligeramente anticipado respecto a un tiempo fuerte C7+, se identifica como entrada anticipada y se alinea al origen del compás para evaluar; no se aplica a anacrusas.
- El cálculo de referencias temporales evita estirar silencios largos de pausa como si fueran retardos extremos; se conservan anclas provisionales de notas reconocidas.
- Pruebas sintéticas de reconocimiento y agregación global añadidas.

## Novedades v0.72

- Reconocimiento musical invariante al BPM: orden y alturas de ataques; proporciones temporales solo para desempatar, BPM estimado tras reconocer.
- Diagnósticos selectivos de rechazo por compás y mano; MIDI IN deja de inundar consola.
- Cursor visible incluso cuando se repite un tick; el compás en curso mantiene el fondo amarillo mientras avanza.
- Versión 0.72 unificada en pestaña, cabecera y README.

## Novedades v0.71

- Trazas MIDI IN activas en consola para diagnóstico.
- Reconocimiento independiente por mano y avance inmediato del cursor al reconocer ataques.
- Arranque del metrónomo flexible cuando existe tempo y seguimiento fiables, sin exigir dos manos.
- Resaltado del siguiente compás al confirmar el anterior.

## Novedades v0.70

- Reconocimiento secuencial por compás desde el inicio configurado; no hay búsqueda libre ni saltos.
- Seguimiento del cursor por ataques reconocidos; recuperación en el siguiente compás pendiente.
- Pausa con Espacio sin evaluación; evaluar únicamente al salir de Escucha activa.
- Referencia expandida completa e inmutable del movimiento; el fin del pasaje se amplía al avanzar.
- Fondo blanco en pasaje y amarillo pálido en compás pendiente; indicador de metrónomo SVG con BPM.

## Novedades v0.69

- Escucha activa evalúa el fragmento continuo completo y conserva los primeros ataques recibidos.
- Métricas de Tempo y Duración a partir de anclas reconocidas de tick, instante y BPM (sin imponer ritmo fijo).
- Alineación musical por secuencia para acordes, con errores temporales medidos posteriormente.
- No se reinicia el fragmento por un salto aparente salvo relocalización confirmada.

## Novedades v0.54

- Sustituye el cursor secundario OSMD tipo 3 (sin sombreado visible en la prueba anterior) por un rectángulo SVG amarillo semitransparente detrás del primer compás.
- El rectángulo utiliza las coordenadas de `GraphicalMeasure`/`stave` de OSMD/VexFlow y se recrea tras cada `render()`.
- Conserva el rótulo «Atento al inicio» y los colores de las notas del primer compás sin cambiar el MusicXML editable.

## Historial de la prueba anterior v0.53

Prueba conceptual de feedback visual mediante APIs/modelo de OSMD, sin manipulación manual del SVG:

- El primer compás se resalta con un segundo cursor OSMD de tipo 3, amarillo translúcido.
- Las notas del pentagrama superior del primer compás se muestran en rojo y las del inferior en azul mediante `NoteheadColor`.
- Se añade temporalmente el rótulo `Atento al inicio` al XML usado para renderizar; el MusicXML editable/descargable no se modifica por esta prueba.

## Novedades v0.52

- En «Grabar y evaluar» sin metrónomo, el acompañamiento queda deshabilitado y la captura continúa hasta que el usuario pulsa STOP.
- La evaluación sin metrónomo es estrictamente secuencial: no usa timing ni duración, y los resultados por compás se adscriben a los compases de las notas esperadas, no al tiempo de captura.
- Si hay una introducción configurada, puede sonar antes de la grabación libre; después de ella la captura queda abierta sin duración fija. El flujo «Repetir» conserva igualmente su introducción especial «REPITE».
- El panel Resultados gana margen lateral; las barras globales se estrechan ligeramente y la zona «Compás» reserva espacio para hasta tres cifras, con círculo de cumplimiento algo mayor y más separación respecto a número, botones y métricas.


## v0.46

- Tempo usa zona de cumplimiento completo de 15 ms y cae linealmente hasta 0 % a 200 ms; el límite de matching de 200 ms sigue siendo una constante independiente.
- El detalle por compás incorpora `compliance`, definido provisionalmente como el mínimo de los parámetros realmente evaluados.
- Cada fila muestra un círculo con el color de ese peor caso y al hacer clic (o Enter/Espacio) mueve el cursor OSMD al compás correspondiente.
- Las columnas de parámetros tienen el mismo ancho compacto; Compás absorbe el espacio sobrante y alinea el número a la derecha.
- El detalle por compases reserva el espacio del scrollbar, mantiene la cabecera fija y desplaza verticalmente las filas cuando sea necesario.

## v0.43

- Corrige el detalle por compases: `ExpectedPerformance` conserva ahora `measure` en cada nota, de modo que `ConsolidatedResults.byMeasure` se genera realmente y alimenta el grid.
- Corrige las barras globales: el relleno es un bloque visible, crece de izquierda a derecha según el porcentaje y usa la escala sólida rojo→naranja→amarillo→verde.
- Mejora el padding y el aprovechamiento vertical del panel Resultados.
- Repertorio ocupa toda la altura disponible del panel para dejar espacio a futuras lecciones.


## v0.43

- Repertorio es el panel visible inicialmente.
- Selector de pieza desplegable personalizado, con título, compositor y época tanto cerrado como en cada opción.
- Toda operación de carga de un nuevo MusicXML fuerza STOP si existe una sesión activa, reutilizando el ciclo de parada MIDI existente.
- `ConsolidatedResults` incorpora `byMeasure` con contadores y porcentajes por compás.
- Panel Resultados funcional: barras globales y grid por compás; se abre automáticamente al finalizar una sesión «Grabar y evaluar».
- Las métricas desactivadas/no disponibles no se presentan como errores. Velocity queda preparado pero sin porcentaje hasta implementar la medición real de dinámica.
- El código de color del grid es únicamente una visualización provisional del porcentaje (≥90, 70–89, <70); no constituye todavía la política pedagógica del estado global de un compás.


## v0.38

- Rediseña la cabecera: STOP pasa junto al indicador compás:beat y `Seguir partitura` baja a la fila de carga y metadatos.
- Sustituye el antiguo botón Configuración por cuatro vistas mutuamente excluyentes: `Repertorio`, `Lección`, `Resultados` y `Ocultar`, repartidas sobre el mismo ancho que el aside.
- `Lección` conserva el panel existente; `Repertorio` y `Resultados` quedan preparados como asides vacíos. `Ocultar` cierra la columna lateral.
- Elimina el botón `Guardar` de la cabecera.
- Añade `[URL]` junto a `Cargar MusicXML`, con modal para cargar un `.xml/.musicxml` remoto mediante `fetch`; recuerda la última URL introducida. La carga remota está sujeta a CORS del servidor de origen.
- El selector de movimiento queda sin rótulo exterior: sus propias opciones (`Movimiento 1`, etc.) identifican el contenido.
- Redondea con `Math.round()` el BPM detectado desde MusicXML antes de usarlo como valor inicial de un movimiento.

## v0.36

- Detecta movimientos cuando la numeración de compases reinicia en `1` después de haber avanzado en el movimiento anterior.
- Añade un selector `Movimiento 1`, `Movimiento 2`… a todo el ancho sobre el intervalo de compases.
- Cada movimiento se extrae en memoria como un MusicXML autónomo y ese mismo XML alimenta tanto OSMD como el parser canónico.
- Cambiar de movimiento equivale a recargar musicalmente la pieza: detiene la sesión, reconstruye canonical/OSMD/sesión y sitúa el cursor al comienzo.
- El movimiento seleccionado se persiste en `localStorage`.
- `BPM`, compás inicial y compás final se recuerdan de forma independiente por movimiento; el resto de opciones de lección son comunes.
- Si un movimiento no tiene configuración guardada, su intervalo se inicializa al primer y último compás y el BPM al primer tempo MusicXML detectado dentro de ese movimiento.
- Mantiene compatibilidad con la configuración plana de v0.35 para el primer movimiento.

## v0.35

- Corrige la rearticulación de una misma nota MIDI `(canal, pitch)` cuando todavía figura como activa.
- Antes de un nuevo `NOTE ON`, se cancela el `NOTE OFF` pendiente de la instancia anterior, se envía su `NOTE OFF` inmediato y sólo después se envía el nuevo `NOTE ON`.
- `activeNotes` conserva ahora la referencia al temporizador de apagado de cada nota normal, manteniendo `activeTimeouts` para la cancelación global usada por STOP/PAUSA/PANIC.
- Un `NOTE OFF` antiguo comprueba que sigue perteneciendo a la instancia activa antes de ejecutarse, evitando que pueda apagar una rearticulación posterior.
- El cambio es general en la capa MIDI y no introduce ningún tratamiento especial para `slur`: `pt_session` puede seguir expresando el legato mediante solapamiento.

## v0.34

- La captura durante la introducción conserva tiempos negativos respecto al inicio musical del pasaje.
- Segunda pasada del evaluador: `ConsolidatedResults` agrega métricas de notas, pitch, timing, duración, omitidas e inesperadas.
- Se registran `ExpectedPerformance`, `CapturedPerformance`, `ConsolidatedPerformance` y `ConsolidatedResults` con la convención `//debug.eval.performance`.

## Ejecución

Servir la carpeta mediante HTTP (por ejemplo Live Server). Web MIDI no debe ejecutarse desde `file://`.

Los dispositivos MIDI se descubren mediante un iframe desechable para evitar mantener `MIDIAccess` vivo cuando no es necesario.

### Depuración y recuperación de Escucha activa

Añadir `?debug=true` a la URL habilita las trazas de consola de la aplicación (incluidos avisos y errores) y sustituye el botón **Ocultar** por **Depurar**, que abre un panel independiente **Desarrollador**, con la configuración de la lección, el JSON musical y ExpectedPerformance. Sin ese parámetro, el panel permanece oculto y la aplicación no emite esas trazas. Los mensajes del navegador y de bibliotecas externas son independientes.

El selector OFF/FLEXIBLE/ESTRICTO está siempre habilitado; `M` cambia y guarda su modo también estando parado. En edición, el atajo para alternar mordentes es ahora `Mayús+M`.

Cambiar de movimiento o de pieza elimina la evaluación anterior, incluidos fondos, colores de notas y resultados. STOP sobre una sesión ya parada también limpia la evaluación; el primer STOP de una sesión en marcha conserva sus resultados para revisarlos.

La consola registra `[ACTIVE INPUT]` (notas MIDI, compás de captura y estado del cursor), `[RECOGNITION]` (patrones esperados, coincidencias, rechazos, esperas y confirmaciones) y `[ACTIVE REWIND]` (borrado manual). Los detalles se imprimen como texto JSON para poder copiarlos junto con una descripción del problema.

Durante una Escucha activa ya iniciada, con el metrónomo en OFF o FLEXIBLE, `←` borra la captura y las referencias de evaluación del compás pendiente y vuelve a su inicio. Otra pulsación sin tocar borra el anterior y retrocede a su inicio. `→` permite avanzar entre los compases borrados hasta el compás donde se detuvo la interpretación; si aún no se ha borrado nada, reinicia ese compás. Si se vuelve a tocar, la siguiente pulsación reinicia de nuevo ese mismo compás. Los compases anteriores al borrado se conservan; el retroceso se detiene en el primer compás. La tecla mantenida no encadena borrados. En FLEXIBLE las flechas fuerzan la suspensión del metrónomo aunque todavía esté sonando; permanece suspendido mientras se navega y se reactiva al reconocer de nuevo la interpretación con tempo fiable.


## Repertorio (v0.38)

Al iniciar, Piano Tutor consulta `repertoire/repertoire.json`. El catálogo inicial incluye Bach BWV 926 y Clementi Op. 36 No. 4. Las rutas `musicXmlUrl` son relativas a la raíz del proyecto y usan el mismo cargador URL que el botón `[URL]`. Un fallo del catálogo no bloquea la carga manual de MusicXML.


## v0.43
Base: v0.39. Amplía el área de Repertorio; oculta Movimiento en obras de un solo movimiento; cabecera de catálogo en blanco con título en negrita; barras y grid de Resultados en español con escala de color; resultados por compás desde `ConsolidatedResults.byMeasure`; tolerancia perfecta de duración ±200 ms con zona muerta; ExpectedPerformance no hereda el solapamiento artificial del legato.


## Cambios de evaluación en v0.43

- Duración: `DURATION_FULL_COMPLIANCE_MS = 50` y `DURATION_ZERO_COMPLIANCE_MS = 500`.
- Entre ambos límites, el cumplimiento de duración desciende linealmente de 100 % a 0 %.
- Las notas omitidas aportan 0 % a Tono, Tempo y Duración (y el mismo criterio queda preparado para Dinámica).
- El criterio se aplica tanto a resultados globales como a `byMeasure`, porque ambos usan el mismo agregador.

## v0.48
- Cursor normal azul celeste con mayor contraste; cursor de edición amarillo.
- Resaltado de edición dirigido sólo a la cabeza de la nota (granate), incluido en acordes con plica compartida cuando OSMD expone `getNoteheadSVGs()`.
- Identidad estructural de nota MusicXML (`sourceMeasureIndex` + `sourceNoteIndex`) conservada en el modelo canónico.
- En modo edición, teclas 1–5 asignan digitación; repetir la misma cifra o pulsar 6 la elimina.
- En modo edición, M cicla: sin mordente → mordente → mordente invertido → sin mordente.
- Tras editar MusicXML se reconstruye el modelo, se recarga OSMD y se restaura la misma nota, posición y modo edición.


## v0.48
- Recupera el resaltado gráfico estable de v0.46: en acordes con plica compartida puede resaltarse el grupo completo.
- En modo edición, 1–5 alternan digitaciones acumulativas del grupo/acorde; 6 las elimina todas.
- M conserva el ciclo sin mordente → mordente → mordente invertido → sin mordente.
- El cursor normal fuerza el azul tras render, reset, show y desplazamientos automáticos; edición fuerza amarillo.


## v0.51

- Corrige el ciclo de mordentes en acordes con plica compartida: el cambio se aplica al grupo completo y el tercer estado elimina el ornamento.
- Al editar digitación o mordentes, el rerender conserva la posición visual sin desplazamiento suave.
- Añade **Descargar cambios** junto a **Cargar MusicXML**. Se habilita tras modificar la partitura y descarga el MusicXML editado conservando el nombre del archivo cargado.


## Novedades v0.51

- El cursor de OSMD sigue ahora el reloj de la sesión y avanza también durante una grabación sin notas enviadas a MIDI OUT.
- Atajo `G`: STOP, vuelve al inicio, cambia a «Grabar y evaluar» e inicia la sesión.
- Atajo `E`: STOP, vuelve al inicio, cambia a «Sólo escuchar» e inicia la sesión.
- Atajo `R`: sesión pedagógica compuesta «ESCUCHA → REPITE». Primero reproduce el pasaje; al terminar vuelve automáticamente al inicio, fuerza una introducción con metrónomo rotulada `REPITE` y pasa a grabación/evaluación. La introducción previa de la fase de escucha se rotula `ESCUCHA`.
- `R` conserva la configuración normal de la lección; la introducción forzada sólo pertenece a la segunda fase del ciclo.

## v0.55
- Corrige el ciclo de vida del sombreado SVG del primer compás: evita recreaciones innecesarias y observa si OSMD sustituye el SVG para restablecer el rectángulo.
- Inserta el sombreado por delante del fondo blanco de página, si lo hay, y por detrás de la notación.
- La corrección es experimental y requiere validación visual en navegador con OSMD.


## v0.56 — Diagnóstico visual de interpretación

- El sombreado SVG persistente de v0.55 se generaliza para compases: gris tenue fuera del pasaje y color de cumplimiento (mismo cálculo que el círculo de Resultados) tras evaluar.
- Las notas evaluadas con fallos se colorean únicamente durante el renderizado temporal de OSMD, sin modificar ni exportar el MusicXML original: omitidas lila, altura equivocada rojo, ataque desviado >= 50 % de la duración prevista azul brillante y duración desviada >= 50 % azul oscuro. Prioridad: omisión, altura, ataque, duración.
- Al empezar otra grabación desaparecen solamente los fondos de resultados; las notas fallidas siguen coloreadas para guiar la repetición. Al finalizar la siguiente evaluación se reemplaza por completo el diagnóstico anterior.
- Se elimina el experimento de primer compás rojo/azul, rótulo «Atento al inicio» y fondo amarillo.
- La identificación usa los índices de nota MusicXML preservados en ExpectedPerformance; los adornos expandidos mantienen la identidad de su nota de origen.

**Limitación experimental:** las coordenadas SVG de OSMD/VexFlow varían entre páginas y configuraciones. Conviene comprobar sombreado y notas fallidas en partituras multipágina y acordes. El sombreado no modifica el evaluador.

## v0.59 — Diagnóstico musical y modo edición

- Mensajes pedagógicos por nota, mostrados en un aviso amarillo al navegar en modo edición, con mano derecha antes de izquierda.
- Comparaciones de altura, ataque y duración expresadas con figuras musicales aproximadas (sin milisegundos).
- Umbral de diagnóstico de duración: menos del 55 % o más del 180 % de la prevista, sin cambiar el cálculo porcentual de evaluación.
- El cursor amarillo sigue indicando edición, sin colorear ni restaurar a negro las notas marcadas tras una evaluación.


## v0.59
- Panel de modo edición fijo, verde sin errores, amarillo con errores; notas por mano y acordes con +.
- Escucha activa: interruptor junto a Iniciar y tecla A; taps MIDI C7 o superiores de duración inferior a 200 ms; detección de BPM por intervalos entre ataques y metrónomo MIDI autónomo desde el siguiente pulso. Espacio pausa/reanuda; Escape/STOP desactiva.

## Cambios v0.59
- Panel de edición con altura fija equivalente a dos líneas.
- Mensajes de tono sin duplicar nombres en acordes; muestra nota interpretada y esperada.
- Trazas en consola `[ACTIVE]` para MIDI IN, Note On/Off, descartes, secuencia, tempo y metrónomo. Se localizan por `//debug.midi.active-listening`.

## v0.60 — Canal MIDI de Escucha activa

- Solo el metrónomo autónomo de **Escucha activa** emite sus Note On/Off en el canal MIDI **1** (índice interno 0), usando la nota detectada en los ticks del usuario.
- El metrónomo ordinario de percusión continúa en el canal **10**; no se modifican sus eventos ni ajustes.
- Se mantiene la duración de 90 ms y la velocidad 80; se añaden trazas `[ACTIVE] MIDI OUT NOTE_ON` y `NOTE_OFF` con canal, nota y duración, identificadas con `//debug.midi.active-listening`.


## v0.61 — Escucha activa: reconocimiento experimental
- `M` en Escucha activa enciende/apaga el metrónomo sin abandonar la escucha.
- Captura de ataques MIDI en memoria, independiente de las notas del metrónomo.
- Nuevo `pt_recognizer.js` con emparejamiento tolerante de patrones por compás, manos y tempo aproximado.
- Preferencia inicial por el compás de inicio configurado y, posteriormente, por la continuidad.
- Actualización de BPM, compases de inicio/fin, manos y cursor cuando la coincidencia es suficiente.
- Trazas `[RECOGNITION]` activas para depuración.
- Primera aproximación experimental: compases con muy pocas notas o patrones repetidos pueden quedar pendientes de confirmación.


## v0.62 — Escucha activa experimental

- Reconocimiento con mayor prioridad para el compás esperado y protección frente a saltos ambiguos.
- Cursor con seguimiento musical por ataques y BPM inferido; se congela cuando el alumno hace una pausa.
- Metrónomo OFF → FLEXIBLE → ESTRICTO, mediante M o clic en el indicador celeste.
- FLEXIBLE espera una interpretación reconocida, suspende los ticks durante las pausas y se resincroniza tras reconocimiento fiable.
- La introducción manual de ticks C7+ activa directamente ESTRICTO.
- El reconocimiento y el metrónomo flexible siguen siendo experimentales: la inferencia depende de la densidad de notas y de la fiabilidad del patrón.

## v0.63 — Relocalización tras pausas
- Reconocimiento bidireccional: tras una pausa se permiten compases anteriores y posteriores, con confirmación equivalente a casi un compás.
- Se descarta la ventana de ataques previa a la pausa y se congela la hipótesis temporal anterior para no forzar un compás falso al volver a tocar.
- Los límites automáticos de la lección acumulan el mínimo y máximo reconocidos, incluso al retroceder.
- El seguidor consulta ataques esperados según las manos detectadas; los silencios y notas largas no provocan por sí solos una pausa.
- En FLEXIBLE, ante relocalización se toleran pulsos adicionales antes de suspender; la búsqueda musical sigue operativa aunque suene el metrónomo.
- Trazas `[RECOGNITION]` para investigar pausas y relocalización.


## v0.66 — reconocimiento polifónico
- Expansión de mordentes compartida por ExpectedPerformance y reconocedor.
- Comparación de grupos de ataques simultáneos en lugar de aplanar acordes.
- Eventos MIDI originales preservados en la captura.
- Trazas MIDI `[ACTIVE]` latentes; trazas `[RECOGNITION]` conservadas.


## v0.66 — Escucha activa
- El metrónomo FLEXIBLE conserva el pulso hasta terminar el compás actual y un margen de entrada al siguiente; una relocalización confirmada cancela la suspensión pendiente.
- Espacio (pausa) y STOP evalúan únicamente el último fragmento reconocido con continuidad, con alineación por secuencia. Los saltos/retrocesos confirmados descartan el anterior sin evaluarlo.
- Los mensajes MIDI de instrumentación detallada permanecen desactivados, y se conservan las trazas de reconocimiento.


## v0.66
- Compás del metrónomo FLEXIBLE protegido hasta emitir su último pulso; trazas [FLEX].
- Evaluación libre por grupos de ataque: acordes simultáneos comparados sin depender del orden de llegada MIDI.
- El modo de captura de Escucha activa conserva los tiempos MIDI originales.


## v0.67 — transición entre compases y captura persistente

- El reconocedor ya no vacía los ataques MIDI al confirmar un compás. Mantiene un historial solapado para reconocer entradas adelantadas del compás siguiente.
- Evita confirmar varios compases con exactamente la misma evidencia.
- Puede identificar provisionalmente el primer ataque esperado del compás siguiente y alinear el cursor sin exigir que se repita una nota larga.
- Los eventos MIDI capturados para evaluación permanecen independientes del estado del reconocedor.

## v0.69: referencia completa en Escucha activa
- Construye ExpectedPerformance desde el compás 1 al último, con ambas manos y mordentes expandidos, al activar y reanudar.
- El reconocedor utiliza esa misma referencia expandida independientemente del rango mutable de la lección.
- La evaluación obtiene una vista filtrada de la referencia completa; no regenera expectativas usando sólo el último compás.
- La captura MIDI cruda permanece independiente de la localización musical.


## Novedades v0.78
- Fondo de compás en espera amarillo con opacidad 25%; la capa del cursor OSMD se mantiene por encima de los resaltados.
- Cursor visible desde la entrada en Escucha activa y actualizado sobre cada nota reconocida.
- Flechas izquierda/derecha durante la espera inicial cambian el compás de inicio y actualizan cursor, amarillo y rango de lección sin recalcular ExpectedPerformance completo.
- La navegación queda deshabilitada al comenzar la interpretación o al esperar continuación.

## Novedades v0.78

- REVISIÓN: las flechas recorren entradas de error sin traducir puntos inesperados a posiciones de notas OSMD.
- Un punto rojo inesperado se selecciona y se resalta directamente; el cursor nativo se reserva para las notas escritas.
- La navegación posterior por notas vuelve a usar ticks musicales exactos, sin desplazamiento acumulativo.
