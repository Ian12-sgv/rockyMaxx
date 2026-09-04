// fetch() nativo no tiene timeout por defecto -- si el otro lado (VPS,
// tienda remota) se pone lento sin cortar la conexion, la peticion puede
// quedar esperando indefinidamente. En los ciclos de sincronizacion en
// segundo plano (bodega-export, MirrorSync, transferencias, cambio de
// precio, devoluciones) eso congela el ciclo completo para siempre, porque
// el candado de "ciclo en curso" no se libera hasta que la peticion
// termine. Este helper corta la espera sola pasado `timeoutMs`.
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`La solicitud no respondio en ${timeoutMs}ms (timeout).`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
