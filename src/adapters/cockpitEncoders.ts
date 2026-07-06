import cockpit from 'cockpit'

async function encoderWorks(codec: string): Promise<boolean> {
  try {
    await cockpit.spawn(
      [
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x180:rate=25:duration=1',
        '-c:v',
        codec,
        '-f',
        'null',
        '-',
      ],
      { err: 'message' },
    )
    return true
  } catch {
    return false
  }
}

export async function detectEncoders(): Promise<{ nvenc: boolean; x264: boolean }> {
  const [nvenc, x264] = await Promise.all([encoderWorks('h264_nvenc'), encoderWorks('libx264')])
  return { nvenc, x264 }
}
