/** Uniform projection fills the viewport; the camera follows the local pilot at the edges. */
export function coopCamera(
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
  focus: { x: number; y: number },
) {
  const scale = Math.max(width / worldWidth, height / worldHeight);
  const visibleWidth = width / scale,
    visibleHeight = height / scale;
  return {
    scale,
    x: Math.max(0, Math.min(worldWidth - visibleWidth, focus.x - visibleWidth / 2)),
    y: Math.max(0, Math.min(worldHeight - visibleHeight, focus.y - visibleHeight / 2)),
  };
}
