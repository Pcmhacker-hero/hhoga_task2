// AudioPlayer — Real TTS audio playback indicator & stop control

interface AudioPlayerProps {
  isPlaying: boolean
  onStop?: () => void
}

export function AudioPlayer({ isPlaying, onStop }: AudioPlayerProps) {
  if (!isPlaying) return null

  return (
    <div className="audio-player" id="audio-player">
      <div className="audio-player-indicator">
        <div className="audio-player-bar" />
        <div className="audio-player-bar" />
        <div className="audio-player-bar" />
        <div className="audio-player-bar" />
      </div>
      <span className="audio-player-label">🔊 Speaking answer...</span>
      {onStop && (
        <button
          onClick={onStop}
          className="audio-player-stop-btn"
          id="audio-stop-button"
          title="Stop playback"
        >
          ⏹ Stop
        </button>
      )}
    </div>
  )
}
