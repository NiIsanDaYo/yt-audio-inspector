export const AUDIO_EXTENSIONS = ['wav', 'wave', 'aif', 'aiff', 'flac', 'm4a', 'aac', 'mp3', 'opus', 'ogg', 'oga'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg'] as const;

export const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS);
export const VIDEO_EXTENSION_SET = new Set<string>(VIDEO_EXTENSIONS);

export const FILE_INPUT_ACCEPT = [
  ...AUDIO_EXTENSIONS.map((extension) => `.${extension}`),
  ...VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
  'audio/*',
  'video/*'
].join(',');

export function extensionFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}
