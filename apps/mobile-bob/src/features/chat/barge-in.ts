export async function beginVoiceCapture(input: {
  stopPlayback?: () => Promise<void> | void;
  startRecognition: () => Promise<void> | void;
}): Promise<void> {
  await input.stopPlayback?.();
  await input.startRecognition();
}
