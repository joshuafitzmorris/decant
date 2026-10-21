/** Hands a file to the browser's download manager. */
export function saveBlob(blob: Blob, name: string) {
  // A generic type, so Safari on an iPhone saves PDFs and web pages instead of opening them in place of Decant.
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
