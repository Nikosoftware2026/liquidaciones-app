// App del celular: recibe una liquidación cifrada en el link (#l=...), la
// muestra, deja corregir y devuelve la aprobación o las correcciones por
// correo. Acá no hay datos: todo llega cifrado y se descifra en el teléfono.
import { abrir, deTexto, guardarClave, leerImporte, linkDeRespuesta, pesos, recuperarClave } from "./nucleo.js";

const GUARDADO = "clave";
const LARGO_MINIMO_PIN = 6;
const raiz = document.getElementById("app");
let clave = null; // en memoria mientras la app está abierta
let cambios = { compras: {}, valores: {} };

function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (nombre === "onclick" || nombre === "onsubmit") nodo[nombre] = valor;
    else if (valor !== null && valor !== false) nodo.setAttribute(nombre, valor === true ? "" : valor);
  }
  for (const hijo of hijos.flat()) if (hijo != null) nodo.append(hijo);
  return nodo;
}

function mostrar(...nodos) {
  raiz.replaceChildren(...nodos.flat().filter(Boolean));
  window.scrollTo(0, 0);
}

function fecha(iso) {
  return iso ? iso.split("-").reverse().join("/") : "sin publicar";
}

function parametro(nombre) {
  return new URLSearchParams(location.hash.slice(1)).get(nombre);
}

// --- alta y PIN ---

function pantallaAlta(claveNueva) {
  const pin = el("input", { type: "password", inputmode: "numeric", placeholder: "PIN nuevo", autocomplete: "off" });
  const repetir = el("input", { type: "password", inputmode: "numeric", placeholder: "Repetir PIN", autocomplete: "off" });
  const aviso = el("p", { class: "aviso" });
  mostrar(
    el("h1", {}, "Vincular este celular"),
    el("p", { class: "suave" }, `Elegí un PIN de al menos ${LARGO_MINIMO_PIN} números. Te lo va a pedir cada vez que abras una liquidación.`),
    el("form", {
      onsubmit: async (evento) => {
        evento.preventDefault();
        if (!/^\d+$/.test(pin.value) || pin.value.length < LARGO_MINIMO_PIN) return (aviso.textContent = `El PIN tiene que ser de al menos ${LARGO_MINIMO_PIN} números.`);
        if (pin.value !== repetir.value) return (aviso.textContent = "Los dos PIN no coinciden.");
        localStorage.setItem(GUARDADO, await guardarClave(pin.value, claveNueva));
        clave = claveNueva;
        history.replaceState(null, "", location.pathname); // la clave no queda en el historial
        pantallaInicio("Celular vinculado. Ya podés abrir los links que te lleguen por correo.");
      },
    }, pin, repetir, aviso, el("button", {}, "Guardar")),
  );
}

function pantallaSinVincular() {
  mostrar(
    el("h1", {}, "Liquidaciones Contables"),
    el("p", {}, "Este celular todavía no está vinculado con la PC."),
    el("p", { class: "suave" }, "En la PC: lista de clientes › \"Revisar desde el celular…\" › \"Vincular celular\", y abrí acá el link que te muestra."),
  );
}

function pantallaPin(alEntrar) {
  const pin = el("input", { type: "password", inputmode: "numeric", autocomplete: "off", autofocus: true });
  const aviso = el("p", { class: "aviso" });
  mostrar(
    el("h1", {}, "Liquidaciones Contables"),
    el("p", { class: "suave" }, "Ingresá tu PIN."),
    el("form", {
      onsubmit: async (evento) => {
        evento.preventDefault();
        clave = await recuperarClave(pin.value, localStorage.getItem(GUARDADO));
        if (clave) return alEntrar();
        aviso.textContent = "PIN incorrecto.";
        pin.value = "";
      },
    }, pin, aviso, el("button", {}, "Entrar")),
  );
}

function pantallaInicio(mensaje) {
  mostrar(
    el("h1", {}, "Liquidaciones Contables"),
    el("p", { class: mensaje ? "ok" : "suave" }, mensaje || "Abrí desde el correo el link de la liquidación que quieras revisar."),
  );
}

// --- liquidación ---

function fila(izquierda, derecha, clase = "") {
  return el("div", { class: "fila " + clase }, el("span", {}, izquierda), el("span", { class: "num" }, derecha));
}

function hayCambios() {
  return Object.keys(cambios.compras).length + Object.keys(cambios.valores).length > 0;
}

function pantallaLiquidacion(liq) {
  const filas = liq.filas.map(([etiqueta, valor, manual, concepto]) => {
    const pedido = concepto in cambios.valores ? cambios.valores[concepto] : undefined;
    const nombre = concepto
      ? el("a", { href: "#", onclick: (e) => { e.preventDefault(); pantallaValor(liq, etiqueta, valor, manual, concepto); } }, etiqueta + " ✎")
      : etiqueta;
    const nota = pedido !== undefined ? ` → ${pedido === null ? "volver al calculado" : pesos(pedido)}` : manual ? " (editado a mano)" : "";
    return fila([nombre, nota ? el("span", { class: "suave" }, nota) : null], pesos(valor), pedido !== undefined || manual ? "editado" : "");
  });
  const total = liq.pagar.reduce((suma, [, importe]) => suma + importe, 0);
  const pagar = liq.pagar.length
    ? liq.pagar.map(([impuesto, importe, vence]) => fila([impuesto, el("br"), el("span", { class: "suave" }, "vence " + fecha(vence))], pesos(importe)))
    : [fila("Sin importes a pagar en este período.", "")];

  const acciones = hayCambios()
    ? [
        el("p", { class: "aviso" }, "Hay correcciones sin enviar. La PC las aplica, recalcula y te manda la liquidación nueva para aprobar."),
        el("button", { onclick: () => responder(liq, { accion: "corregir", compras: cambios.compras, valores: cambios.valores }) }, "Enviar correcciones"),
        el("button", { class: "secundario", onclick: () => { cambios = { compras: {}, valores: {} }; pantallaLiquidacion(liq); } }, "Descartar correcciones"),
      ]
    : [el("button", { onclick: () => responder(liq, { accion: "aprobar" }) }, "Aprobar y generar el boleto")];

  mostrar(
    el("h1", {}, liq.cliente),
    el("p", { class: "suave" }, `Cliente Nº ${liq.nro} · ${liq.periodo} · calculada el ${fecha(liq.generado.slice(0, 10))}`),
    el("h2", {}, "Liquidación"), el("div", { class: "tarjeta" }, filas),
    el("h2", {}, "Datos levantados de DGI"),
    el("div", { class: "tarjeta" },
      el("div", { class: "fila" }, el("a", { href: "#", onclick: (e) => { e.preventDefault(); pantallaCompras(liq); } }, `Compras (${liq.compras.length}) ›`)),
      el("div", { class: "fila" }, el("a", { href: "#", onclick: (e) => { e.preventDefault(); pantallaResguardos(liq); } }, `Resguardos y retenciones (${liq.resguardos.length}) ›`))),
    el("h2", {}, "A pagar"), el("div", { class: "tarjeta" }, pagar, fila("Total", pesos(total), "total")),
    acciones,
  );
}

function volver(liq) {
  return el("a", { href: "#", onclick: (e) => { e.preventDefault(); pantallaLiquidacion(liq); } }, "‹ " + liq.cliente);
}

function pantallaCompras(liq) {
  const tarjetas = liq.compras.map(([id, dia, proveedor, documento, neto, iva, pct, sinTc]) => {
    const actual = id in cambios.compras ? cambios.compras[id] : pct;
    const campo = el("input", { class: "chico", inputmode: "decimal", value: String(actual) });
    const aviso = el("span", { class: "aviso" });
    const aplicar = () => {
      const nuevo = parseFloat(campo.value.replace(",", "."));
      if (!(nuevo >= 0 && nuevo <= 100)) return (aviso.textContent = " de 0 a 100");
      if (nuevo === pct) delete cambios.compras[id]; else cambios.compras[id] = nuevo;
      pantallaCompras(liq);
    };
    return el("div", { class: "tarjeta" + (actual === 0 ? " apagada" : "") + (id in cambios.compras ? " editado" : "") },
      fila(el("b", {}, proveedor), pesos(neto)),
      el("div", { class: "suave" }, `${fecha(dia)} · ${documento}`),
      fila("IVA " + pesos(iva), "deducible " + pesos(iva * actual / 100)),
      sinTc ? el("div", { class: "aviso" }, "Falta el tipo de cambio (cargalo en la PC).") : null,
      el("div", { class: "linea" }, campo, el("span", {}, "%"), el("button", { class: "chico", onclick: aplicar }, "Aplicar"), aviso));
  });
  mostrar(volver(liq), el("h1", {}, `Compras de DGI (${liq.compras.length})`),
    el("p", { class: "suave" }, "Poné 0 % para que una compra no se considere. Los cambios se mandan a la PC al tocar \"Enviar correcciones\"."),
    tarjetas.length ? tarjetas : el("p", {}, "No hay compras en este período."));
}

function pantallaResguardos(liq) {
  const tarjetas = liq.resguardos.map(([dia, agente, documento, tipo, importe]) =>
    el("div", { class: "tarjeta" }, fila(el("b", {}, agente), pesos(importe)), el("div", { class: "suave" }, `${tipo} · ${fecha(dia)} · ${documento}`)));
  mostrar(volver(liq), el("h1", {}, `Resguardos y retenciones (${liq.resguardos.length})`),
    el("p", { class: "suave" }, "Si falta alguno, corregí el total tocando \"Retenciones IVA\" o \"Retenciones IRPF/IRAE\" en la liquidación."),
    tarjetas.length ? tarjetas : el("p", {}, "No hay resguardos ni retenciones en este período."));
}

function pantallaValor(liq, etiqueta, valor, manual, concepto) {
  const pedido = cambios.valores[concepto];
  const campo = el("input", { inputmode: "decimal", value: String(Math.round((pedido ?? valor) / 100)), autofocus: true });
  const aviso = el("p", { class: "aviso" });
  mostrar(volver(liq), el("h1", {}, etiqueta),
    el("p", { class: "suave" }, `Valor actual ${pesos(valor)}${manual ? " (editado a mano)" : ""}`),
    el("form", {
      onsubmit: (evento) => {
        evento.preventDefault();
        const importe = leerImporte(campo.value);
        if (importe === null) return (aviso.textContent = "Escribí un importe válido, ej. 12500 o 12.500,50");
        if (importe === valor) delete cambios.valores[concepto]; else cambios.valores[concepto] = importe;
        pantallaLiquidacion(liq);
      },
    }, campo, aviso, el("button", {}, "Usar este valor")),
    manual ? el("button", { class: "secundario", onclick: () => { cambios.valores[concepto] = null; pantallaLiquidacion(liq); } }, "Volver al calculado") : null,
    el("p", { class: "suave" }, "El valor editado reemplaza al calculado; la PC recalcula lo que depende de él."));
}

async function responder(liq, respuesta) {
  const link = await linkDeRespuesta(clave, liq.responder, { v: 1, lote: liq.lote, ...respuesta });
  const aprobar = respuesta.accion === "aprobar";
  mostrar(
    el("h1", {}, aprobar ? "Aprobar" : "Enviar correcciones"),
    el("p", {}, "Se va a abrir tu correo con la respuesta ya armada (cifrada). Solo tocá enviar."),
    el("a", { class: "boton", href: link }, "Abrir el correo"),
    el("p", { class: "suave" }, aprobar
      ? "Cuando la PC la reciba, confirma la liquidación y te manda los montos del boleto."
      : "Cuando la PC la reciba, recalcula y te manda la liquidación nueva para aprobar."),
    volver(liq),
  );
}

function pantallaBoleto(boleto) {
  const total = boleto.lineas.reduce((suma, linea) => suma + linea[3], 0);
  const lineas = boleto.lineas.map(([organismo, impuesto, codigo, importe, vence]) =>
    fila([`${organismo} · ${impuesto}${codigo ? " · código " + codigo : ""}`, el("br"), el("span", { class: "suave" }, "vence " + fecha(vence))], pesos(importe)));
  const fonasa = boleto.lineas.some((linea) => linea[1] === "FONASA");
  mostrar(
    el("h1", {}, boleto.cliente),
    el("p", { class: "suave" }, `Cliente Nº ${boleto.nro} · ${boleto.periodo} · RUT ${boleto.rut || "-"}`),
    el("p", { class: "ok" }, "✓ Liquidación confirmada."),
    el("h2", {}, "Montos del boleto de pago"),
    el("div", { class: "tarjeta" }, lineas.length ? lineas : fila("No hay importes a pagar en este período.", ""), fila("Total a pagar", pesos(total), "total")),
    fonasa ? el("div", { class: "tarjeta" }, el("b", {}, "Datos para el boleto de FONASA (BPS)"),
      fila("Nº de BPS", boleto.bps || "-"), fila("RUT", boleto.rut || "-"), fila("CI", boleto.ci || "-"), fila("Nacimiento", boleto.nacimiento ? fecha(boleto.nacimiento) : "-")) : null,
  );
}

// --- arranque ---

async function abrirLink() {
  const sobre = parametro("l");
  if (!sobre) return pantallaInicio();
  let contenido;
  try {
    contenido = await abrir(clave, sobre);
  } catch {
    return mostrar(el("h1", {}, "No se pudo abrir"), el("p", {}, "Este link no es de la PC vinculada con este celular, o llegó cortado."));
  }
  cambios = { compras: {}, valores: {} };
  if (contenido.t === "boleto") pantallaBoleto(contenido); else pantallaLiquidacion(contenido);
}

function arrancar() {
  const claveNueva = parametro("clave");
  if (claveNueva) return pantallaAlta(deTexto(claveNueva));
  if (!localStorage.getItem(GUARDADO)) return pantallaSinVincular();
  if (clave) return abrirLink();
  pantallaPin(abrirLink);
}

window.addEventListener("hashchange", arrancar);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
arrancar();
