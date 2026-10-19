import { useEffect, useState } from 'react';

/**
 * Accepts files dropped anywhere on the page (including whole folders) and
 * files pasted from the clipboard. Returns whether a drag is in progress.
 */
export function useFileIntake(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      void filesFromDataTransfer(event.dataTransfer).then((files) => files.length && onFiles(files));
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    };
  }, [onFiles]);

  return dragging;
}

/** Reads dropped items, walking into folders. Hidden files like .DS_Store are skipped. */
async function filesFromDataTransfer(transfer: DataTransfer): Promise<File[]> {
  // Entries must be taken synchronously; the DataTransfer empties after the event.
  const entries = Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const plainFiles = Array.from(transfer.files);
  if (entries.length === 0) return plainFiles;

  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.name.startsWith('.')) return;
    if (entry.isFile) {
      files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  try {
    for (const entry of entries) await walk(entry);
    return files;
  } catch {
    return plainFiles;
  }
}
