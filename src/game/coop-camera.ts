/** Fixed uniform view of the entire arena; pilot movement never pans the camera. */
export function coopCamera(
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
  _focus: { x: number; y: number },
) {
  const scale = Math.min(width / worldWidth, height / worldHeight);
  return {
    scale,
    x: (worldWidth - width / scale) / 2,
    y: (worldHeight - height / scale) / 2,
  };
}
