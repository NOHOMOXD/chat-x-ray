export function downloadJson(json: string, prefix: string, channel: string) {
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${prefix}-${channel || 'chat'}-${date}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
}
