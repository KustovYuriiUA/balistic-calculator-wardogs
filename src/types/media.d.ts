// Chromium's insertable streams for video: MediaStreamTrackProcessor turns a capture track into VideoFrames. Not in
// the DOM typings yet.
declare class MediaStreamTrackProcessor<T = VideoFrame> {
  constructor(init: {
    track: MediaStreamTrack
    maxBufferSize?: number
  })

  readonly readable: ReadableStream<T>
}
