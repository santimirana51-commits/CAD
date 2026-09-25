// Lazy DXF — only load dxf.js (164k) when user does OPEN/DXF
export async function loadDxf() {
  await import('../../../dxf.js');
  return window.NasjDxf || window.Dxf || null;
}
export default { loadDxf };
