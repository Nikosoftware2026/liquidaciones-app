// Cifrado de la app: espejo de src/movil/cifrado_lotes.py (AES-256-GCM,
// zlib, base64 apto para links). Sin dependencias: funciona en el navegador
// del celular y en Node (para las pruebas).

const LARGO_NONCE = 12;
const VUELTAS_PIN = 200000;

export function aTexto(bytes) {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deTexto(texto) {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

async function pasar(bytes, transformador) {
  const flujo = new Blob([bytes]).stream().pipeThrough(transformador);
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

async function llave(claveBytes) {
  return crypto.subtle.importKey("raw", claveBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Texto cifrado (de un link o de una respuesta) -> objeto. Lanza si la clave no es la de la PC.
export async function abrir(claveBytes, texto) {
  const datos = deTexto(texto);
  const plano = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: datos.slice(0, LARGO_NONCE) }, await llave(claveBytes), datos.slice(LARGO_NONCE));
  const json = await pasar(new Uint8Array(plano), new DecompressionStream("deflate"));
  return JSON.parse(new TextDecoder().decode(json));
}

export async function sellar(claveBytes, contenido) {
  const comprimido = await pasar(new TextEncoder().encode(JSON.stringify(contenido)), new CompressionStream("deflate"));
  const nonce = crypto.getRandomValues(new Uint8Array(LARGO_NONCE));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await llave(claveBytes), comprimido));
  const todo = new Uint8Array(LARGO_NONCE + cifrado.length);
  todo.set(nonce);
  todo.set(cifrado, LARGO_NONCE);
  return aTexto(todo);
}

async function llaveDePin(pin, sal) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sal, iterations: VUELTAS_PIN, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// La clave de la PC queda guardada en el teléfono cifrada con el PIN.
export async function guardarClave(pin, claveBytes) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(LARGO_NONCE));
  const cifrada = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await llaveDePin(pin, sal), claveBytes));
  return [aTexto(sal), aTexto(nonce), aTexto(cifrada)].join(".");
}

// Devuelve la clave, o null si el PIN no es.
export async function recuperarClave(pin, guardado) {
  const [sal, nonce, cifrada] = guardado.split(".").map(deTexto);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await llaveDePin(pin, sal), cifrada));
  } catch {
    return null;
  }
}

// Respuesta lista para mandar por correo a la PC.
export async function linkDeRespuesta(claveBytes, destino, respuesta) {
  const sobre = await sellar(claveBytes, respuesta);
  return `mailto:${destino}?subject=${encodeURIComponent("LIQ-RESP " + respuesta.lote)}&body=${encodeURIComponent("LIQ1:" + sobre + ":FIN")}`;
}

export function pesos(centesimos) {
  return "$ " + Math.round(centesimos / 100).toLocaleString("es-UY");
}

// "12.500,50", "12500" o "12500.5" -> centésimos (null si no es un número).
export function leerImporte(texto) {
  let t = texto.trim().replace(/[$\s]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
