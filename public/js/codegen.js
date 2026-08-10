function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Builds curl / fetch / axios snippets from a resolved proxy payload.
export function generateSnippets({ method, url, headers, body }) {
  const headerEntries = Object.entries(headers || {});
  const isMultipart = body && typeof body === 'object';

  const curlLines = [`curl -X ${method} ${shellQuote(url)}`];
  headerEntries.forEach(([key, value]) => curlLines.push(`  -H ${shellQuote(`${key}: ${value}`)}`));
  if (isMultipart) {
    (body.fields || []).forEach((f) => curlLines.push(`  -F ${shellQuote(`${f.name}=${f.value}`)}`));
    (body.files || []).forEach((f) => curlLines.push(`  -F ${shellQuote(`${f.name}=@${f.filename}`)}`));
  } else if (body) {
    curlLines.push(`  --data ${shellQuote(body)}`);
  }
  const curl = curlLines.join(' \\\n');

  if (isMultipart) {
    const formLines = [
      'const form = new FormData();',
      ...(body.fields || []).map((f) => `form.append(${JSON.stringify(f.name)}, ${JSON.stringify(f.value)});`),
      ...(body.files || []).map((f) => `form.append(${JSON.stringify(f.name)}, fileInput.files[0]); // ${f.filename}`),
    ];
    const fetchCode = [
      ...formLines,
      `const response = await fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(method)}, body: form });`,
      'console.log(await response.json());',
    ].join('\n');
    const axiosCode = [
      ...formLines,
      `const response = await axios.${method.toLowerCase()}(${JSON.stringify(url)}, form);`,
      'console.log(response.data);',
    ].join('\n');
    return { curl, fetch: fetchCode, axios: axiosCode };
  }

  const fetchOptions = { method, headers: headers || {} };
  if (body) fetchOptions.body = body;
  const fetchCode = [
    `const response = await fetch(${JSON.stringify(url)}, ${JSON.stringify(fetchOptions, null, 2)});`,
    'const data = await response.json();',
    'console.log(data);',
  ].join('\n');

  const axiosConfig = { method: method.toLowerCase(), url, headers: headers || {} };
  if (body) {
    try {
      axiosConfig.data = JSON.parse(body);
    } catch {
      axiosConfig.data = body;
    }
  }
  const axiosCode = [
    `const response = await axios(${JSON.stringify(axiosConfig, null, 2)});`,
    'console.log(response.data);',
  ].join('\n');

  return { curl, fetch: fetchCode, axios: axiosCode };
}
