// Las entradas conservan el contexto de la evaluación; navegar no consulta el cursor.
export function buildReviewEntries(items, notes, diagnosticsForItem, pitchName) {
  const groups = new Map();
  for (const item of items) {
    if (!item.expected) continue;
    const expected = item.expected;
    const source = notes.find(note => note.sourceMeasureIndex === expected.sourceMeasureIndex &&
      note.sourceNoteIndex === expected.sourceNoteIndex);
    const tick = source?.startTick ?? expected.startTick;
    const staff = source?.staff ?? expected.channel + 1;
    const key = `${tick}:${staff}`;
    if (!groups.has(key)) {
      const written = notes.filter(note => note.startTick === tick && note.staff === staff)
        .sort((a, b) => a.pitch - b.pitch).map(note => ({ ...note }));
      groups.set(key, { tick, staff, measure: expected.measure, notes: written, items: [] });
    }
    groups.get(key).items.push({ expected: { ...expected }, captured: item.captured ? { ...item.captured } : null,
      match: item.match, diagnostics: diagnosticsForItem(item).map(diagnostic => ({ ...diagnostic })) });
  }
  const entries = new Map();
  for (const group of [...groups.values()].sort((a, b) => a.tick - b.tick || a.staff - b.staff)) {
    const errors = group.items.filter(item => item.diagnostics.length);
    if (!errors.length) continue;
    const pitches = [...new Set((group.notes.length ? group.notes : group.items.map(item => item.expected)).map(note => note.pitch))].sort((a, b) => a - b);
    const omitted = [...new Set(errors.filter(item => item.match === 'OMITTED').map(item => item.expected.pitch))].sort((a, b) => a - b);
    const messages = [];
    if (omitted.length) {
      const allOmitted = group.items.every(item => item.match === 'OMITTED') && pitches.every(pitch => omitted.includes(pitch));
      messages.push(allOmitted ? `Has omitido ${pitches.length === 1 ? 'esta nota' : 'estas notas'}.`
        : `Has omitido ${omitted.map(pitchName).join('+')}.`);
    }
    for (const item of errors) {
      for (const diagnostic of item.diagnostics) {
        if (diagnostic.kind !== 'omitted') messages.push(diagnostic.message);
      }
    }
    const hand = group.staff === 1 ? 'Mano derecha' : group.staff === 2 ? 'Mano izquierda' : `Pentagrama ${group.staff}`;
    group.message = `${hand} - ${pitches.map(pitchName).join('+')}: ${[...new Set(messages)].join(' · ')}`;
    if (!entries.has(group.tick)) entries.set(group.tick, { tick: group.tick, measure: group.measure, groups: [], lines: [], unexpected: false });
    const entry = entries.get(group.tick);
    entry.groups.push(group);
    entry.lines.push(group.message);
  }
  return [...entries.values()].map(entry => ({ ...entry, message: entry.lines.join('\n') }));
}
