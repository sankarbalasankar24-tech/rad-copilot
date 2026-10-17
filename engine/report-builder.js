// report-builder.js — assembles the final plain text report (findings +
// impression) ready to paste into hospital reporting software.

export function buildReportText(engine, impression) {
  const snap = engine.snapshot();
  const out = [];
  out.push(snap.indication ? `CLINICAL INDICATION: ${snap.indication}` : null);
  const studyLine = engine.template.studyType ? `STUDY: ${engine.template.studyType}` : null;
  out.push(studyLine);
  out.push('');
  out.push('FINDINGS:');
  for (const section of snap.sections) {
    out.push('');
    out.push(`${section.title}:`);
    for (const line of section.lines) {
      out.push(line.text);
    }
  }
  if (impression) {
    out.push('');
    out.push(`${impression.heading}:`);
    impression.lines.forEach((l, i) => {
      out.push(`${i + 1}. ${l.text}`);
    });
    for (const n of impression.notes) {
      out.push(`- ${n.text}`);
    }
  }
  return out.filter((x) => x !== null && x !== undefined).join('\n');
}
