export async function ocrImage(arrayBuffer){
  const { createWorker } = Tesseract;
  const worker = await createWorker('eng'); // add 'spa' for Spanish if needed
  const blob = new Blob([arrayBuffer]);
  const url = URL.createObjectURL(blob);
  const { data: { text } } = await worker.recognize(url);
  await worker.terminate();
  return { text };
}
