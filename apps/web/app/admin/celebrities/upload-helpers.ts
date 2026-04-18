export async function fileToBitmap(file: File): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

export async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
