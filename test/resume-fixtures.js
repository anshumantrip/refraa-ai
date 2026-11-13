export const fixtureLines = ['Test Candidate', 'candidate@fixture.example', '+1 555 010 0199',
  'Education', 'Bachelor of Science, Test University, CGPA: 3.7/4', 'Skills: React, SQL',
  'Work Experience', 'Engineer — Jan 2020 to Mar 2022, 26 months', 'Internships', 'Research Intern — 2023 to 2024',
  'Projects', 'Test API: Built a REST service', 'Certifications', 'Sample Credential'];

export function pdfFixture(lines = fixtureLines, options = {}) {
  const encoder = lines.map((line, index) => (index ? '0 -18 Td ' : '') +
    '(' + line.replace(/[^\x20-\x7e]/g, '-').replace(/[()\\]/g, '\\$&') + ') Tj').join('\n');
  const content = lines.length ? 'BT /F1 12 Tf 50 750 Td\n' + encoder + '\nET' : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'
  ];
  if (options.encrypted) objects.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /O <' + '00'.repeat(32) +
    '> /U <' + '00'.repeat(32) + '> /P -4 >>');
  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n \n');
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = pdf.length;
  return Buffer.from(pdf + 'xref\n0 ' + offsets.length + '\n' + offsets.join('') + 'trailer\n<< /Size ' +
    offsets.length + ' /Root 1 0 R ' + (options.encrypted ? '/Encrypt 6 0 R /ID [<0102><0102>] ' : '') +
    '>>\nstartxref\n' + xref + '\n%%EOF');
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

export function docxFixture(lines = fixtureLines, prefix = '') {
  const xml = prefix + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    lines.map(line => '<w:p><w:r><w:t>' + line.replaceAll('&', '&amp;').replaceAll('<', '&lt;') +
      '</w:t></w:r></w:p>').join('') + '</w:body></w:document>';
  const items = [['[Content_Types].xml', '<Types/>'], ['word/document.xml', xml]];
  const data = [];
  const directory = [];
  let offset = 0;
  for (const [filename, content] of items) {
    const name = Buffer.from(filename);
    const body = Buffer.from(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(body), 14); header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(body), 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    data.push(header, name, body); directory.push(central, name);
    offset += header.length + name.length + body.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(Buffer.concat(directory).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, ...directory, end]);
}
