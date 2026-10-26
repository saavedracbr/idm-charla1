/* Deck de la charla 1. No necesita compilar ni internet: GSAP, Chart.js y
   qrcode-generator están en vendor/ y las fuentes en fuentes/.
   Atajos: ←/→ o clicker, F pantalla completa, P vista de presentador,
   C cronómetro de la slide (Shift+C lo reinicia), B pantalla negra, R reinicia el reloj (presentador).
   Modos por URL: ?presentador (vista de notas) e ?imprimir (exportar a PDF). */

// Completa estas URL antes de la charla: los QR del cierre se generan de aquí.
// "texto" es opcional: una versión corta de la URL para quien no pueda escanear.
const CONFIG = {
  carpeta: { url: 'https://drive.google.com/drive/folders/1WGhy9UMC4smE3V1lrPgSV28VjGmws0HU?usp=sharing', texto: '' },
  encuestaSalida: { url: 'https://forms.gle/dFvWqohf5UvaF8SB9', texto: 'forms.gle/dFvWqohf5UvaF8SB9' },
};

// De datos/tikay_respuestas_control.md (salida de scripts/verificar_tikay.py).
const DATOS = {
  ejes: [['T1', '2025'], 'T2', 'T3', 'T4', ['T1', '2026'], 'T2', 'T3'],
  nombres: ['T1 2025', 'T2 2025', 'T3 2025', 'T4 2025', 'T1 2026', 'T2 2026', 'T3 2026'],
  ventasMiles: [30.9, 68.1, 79.9, 99.3, 91.9, 115.0, 89.9],
  recompra90: [26.5, 24.6, 23.0, 18.3, 17.7, 11.8, null],
};

const MINUTOS_CHARLA = 60;
const parametros = new URLSearchParams(location.search);
const MODO = parametros.has('presentador') ? 'presentador' : parametros.has('imprimir') ? 'imprimir' : 'proyector';
const SIN_MOVIMIENTO = MODO === 'imprimir' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const ANIMACION_GRAFICOS = { duration: 1100, easing: 'easeOutQuart' };

const raiz = document.documentElement;
const escenario = document.getElementById('escenario');
const slides = [...escenario.querySelectorAll('.slide')];
const graficos = new Map(); // canvas -> instancia de Chart
const cronometros = new Map(); // índice de slide -> estado del cronómetro
let actual = -1;
let negroActivo = false;
let ventanaPresentador = null;
let inicioCharla = leerInicio();

// ---------- Escala y navegación ----------

function escalar() {
  const caja = MODO === 'presentador'
    ? document.querySelector('.pres-actual').getBoundingClientRect()
    : { width: innerWidth, height: innerHeight };
  raiz.style.setProperty('--escala', Math.min(caja.width / 1920, caja.height / 1080));
  if (MODO === 'presentador') escalarMiniatura();
}

function ir(indice, { emitir = true } = {}) {
  indice = Math.max(0, Math.min(slides.length - 1, indice));
  if (indice === actual) return;
  slides[actual]?.classList.remove('activa');
  actual = indice;
  slides[actual].classList.add('activa');
  animarEntrada(slides[actual]);
  document.querySelector('#progreso span').style.width = `${((actual + 1) / slides.length) * 100}%`;
  history.replaceState(null, '', `#${actual + 1}`);
  if (emitir) enviar({ tipo: 'ir', indice: actual });
  if (MODO === 'presentador') {
    if (!inicioCharla && actual > 0) reiniciarReloj();
    actualizarPresentador();
  }
}

const TECLAS_SIGUIENTE = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
const TECLAS_ANTERIOR = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

document.addEventListener('keydown', (evento) => {
  if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
  const tecla = evento.key.length === 1 ? evento.key.toLowerCase() : evento.key;
  if (TECLAS_SIGUIENTE.includes(tecla)) ir(actual + 1);
  else if (TECLAS_ANTERIOR.includes(tecla)) ir(actual - 1);
  else if (tecla === 'Home') ir(0);
  else if (tecla === 'End') ir(slides.length - 1);
  else if (tecla === 'f') alternarPantallaCompleta();
  else if (tecla === 'p') abrirPresentador();
  else if (tecla === 'c' && evento.shiftKey) reiniciarCronometro(actual);
  else if (tecla === 'c') alternarCronometro(actual);
  else if (tecla === 'b' || tecla === '.') aplicarNegro(!negroActivo);
  else if (tecla === 'r' && MODO === 'presentador') reiniciarReloj();
  else return;
  evento.preventDefault();
});

// Permite saltar a una slide escribiendo #n en la barra de direcciones.
addEventListener('hashchange', () => {
  const numero = parseInt(location.hash.slice(1), 10);
  if (numero) ir(numero - 1);
});

function alternarPantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen();
  else raiz.requestFullscreen?.();
}

// ---------- Animaciones ----------

const ANIMACIONES = {
  crear(slide) {
    gsap.fromTo(slide.querySelectorAll('.letra'), { autoAlpha: 0, y: 40, scale: 0.92 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, stagger: 0.16, ease: 'back.out(1.7)', delay: 0.35, overwrite: true });
  },
  proceso(slide) {
    gsap.fromTo(slide.querySelector('.conector'), { scaleX: 0 },
      { scaleX: 1, duration: 1.2, ease: 'power2.inOut', delay: 0.3, overwrite: true });
  },
  problema(slide) {
    gsap.fromTo(slide.querySelector('.por-que'), { autoAlpha: 0, scale: 0.6 },
      { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'back.out(2)', delay: 1.9, overwrite: true });
  },
};

function animarEntrada(slide) {
  if (SIN_MOVIMIENTO) return;
  gsap.fromTo(slide.querySelectorAll('[data-animar]'), { autoAlpha: 0, y: 28 },
    { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.07, ease: 'power3.out', delay: 0.12, overwrite: true });
  ANIMACIONES[slide.dataset.animacion]?.(slide);
  // Los gráficos se vuelven a dibujar desde cero cada vez que se entra a la slide.
  slide.querySelectorAll('canvas').forEach((lienzo) => {
    const grafico = graficos.get(lienzo);
    if (!grafico) return;
    grafico.reset();
    gsap.delayedCall(0.4, () => grafico.update());
  });
}

// ---------- Gráficos ----------

// Etiqueta solo los puntos que cuentan la historia (inicio y punto clave).
const etiquetasDirectas = {
  id: 'etiquetasDirectas',
  afterDatasetsDraw(grafico, _argumentos, opciones) {
    const { ctx } = grafico;
    const puntos = grafico.getDatasetMeta(0).data;
    ctx.save();
    ctx.font = '700 24px Jakarta';
    ctx.fillStyle = opciones.color;
    ctx.textAlign = 'center';
    opciones.indices.forEach((i, n) => {
      // "abajo" evita que la etiqueta cruce la línea cuando el punto viene de una caída.
      const abajo = opciones.posiciones?.[n] === 'abajo';
      ctx.textBaseline = abajo ? 'top' : 'bottom';
      ctx.fillText(opciones.formato(grafico.data.datasets[0].data[i]), puntos[i].x, puntos[i].y + (abajo ? 16 : -14));
    });
    ctx.restore();
  },
};

function crearGraficos() {
  const estilo = getComputedStyle(raiz);
  const color = (variable) => estilo.getPropertyValue(variable).trim();
  Chart.defaults.font.family = 'Jakarta';
  Chart.defaults.font.size = 22;
  Chart.defaults.color = color('--suave');

  const opciones = ({ maximo, paso, formatoEje, indices, posiciones, formato }) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: SIN_MOVIMIENTO ? false : ANIMACION_GRAFICOS,
    layout: { padding: { top: 40, right: 8 } },
    scales: {
      // offset alinea los puntos de la línea con el centro de las barras del otro gráfico.
      x: { offset: true, grid: { display: false }, border: { color: color('--linea') } },
      y: {
        beginAtZero: true, max: maximo,
        grid: { color: '#ebe8e1', lineWidth: 1 }, border: { display: false },
        ticks: { stepSize: paso, padding: 12, callback: formatoEje },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        padding: 14, titleFont: { size: 20 }, bodyFont: { size: 22 }, displayColors: false,
        callbacks: { title: (items) => DATOS.nombres[items[0].dataIndex], label: (item) => formato(item.raw) },
      },
      etiquetasDirectas: { indices, posiciones, formato, color: color('--tinta') },
    },
  });

  const lienzoVentas = document.getElementById('grafico-ventas');
  graficos.set(lienzoVentas, new Chart(lienzoVentas, {
    type: 'bar',
    plugins: [etiquetasDirectas],
    data: {
      labels: DATOS.ejes,
      datasets: [{
        data: DATOS.ventasMiles,
        backgroundColor: color('--acento'),
        borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
        borderSkipped: false,
        maxBarThickness: 44,
      }],
    },
    options: opciones({
      maximo: 125, paso: 25, formatoEje: (valor) => valor,
      indices: [0, 5], formato: (valor) => `S/ ${valor.toFixed(1)} mil`,
    }),
  }));

  const lienzoRecompra = document.getElementById('grafico-recompra');
  graficos.set(lienzoRecompra, new Chart(lienzoRecompra, {
    type: 'line',
    plugins: [etiquetasDirectas],
    data: {
      labels: DATOS.ejes,
      datasets: [{
        data: DATOS.recompra90,
        borderColor: color('--caida'),
        borderWidth: 3,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: color('--caida'),
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        spanGaps: false,
      }],
    },
    options: opciones({
      maximo: 30, paso: 10, formatoEje: (valor) => `${valor} %`,
      indices: [0, 5], posiciones: ['arriba', 'abajo'], formato: (valor) => `${valor.toFixed(1)} %`,
    }),
  }));
}

// ---------- Cronómetros ----------

function prepararCronometros() {
  slides.forEach((slide, indice) => {
    const el = slide.querySelector('.cronometro');
    if (!el) return;
    el.innerHTML = '<div class="tiempo"></div><div class="barra"><span></span></div><div class="estado"></div>';
    const total = Number(el.dataset.segundos) * 1000;
    const estado = { el, total, restante: total, fin: null };
    cronometros.set(indice, estado);
    el.addEventListener('click', () => alternarCronometro(indice));
    pintarCronometro(estado);
  });
  setInterval(() => cronometros.forEach((estado) => estado.fin && pintarCronometro(estado)), 200);
}

// Iniciar, pausar o, si ya terminó, volver al tiempo completo.
function alternarCronometro(indice) {
  const estado = cronometros.get(indice);
  if (!estado) return;
  if (estado.fin) {
    estado.restante = Math.max(0, estado.fin - Date.now());
    estado.fin = null;
  } else if (estado.restante <= 0) {
    estado.restante = estado.total;
  } else {
    estado.fin = Date.now() + estado.restante;
  }
  pintarCronometro(estado);
  enviar({ tipo: 'cronometro', indice, restante: estado.restante, fin: estado.fin });
}

function reiniciarCronometro(indice) {
  const estado = cronometros.get(indice);
  if (!estado) return;
  Object.assign(estado, { restante: estado.total, fin: null });
  pintarCronometro(estado);
  enviar({ tipo: 'cronometro', indice, restante: estado.restante, fin: null });
}

function aplicarCronometro(indice, restante, fin) {
  const estado = cronometros.get(indice);
  if (!estado) return;
  Object.assign(estado, { restante, fin });
  pintarCronometro(estado);
}

function pintarCronometro(estado) {
  if (estado.fin && Date.now() >= estado.fin) Object.assign(estado, { fin: null, restante: 0 });
  const restante = estado.fin ? estado.fin - Date.now() : estado.restante;
  const segundos = Math.ceil(restante / 1000);
  estado.el.querySelector('.tiempo').textContent = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
  estado.el.querySelector('.barra span').style.transform = `scaleX(${restante / estado.total})`;
  estado.el.classList.toggle('corriendo', Boolean(estado.fin));
  estado.el.classList.toggle('terminado', restante <= 0);
  estado.el.querySelector('.estado').textContent =
    restante <= 0 ? '¡Tiempo! · C para reiniciar'
      : estado.fin ? 'En curso · C para pausar'
        : restante < estado.total ? 'En pausa · C para seguir' : 'C para iniciar';
}

// ---------- Pantalla negra ----------

function aplicarNegro(activo, { emitir = true } = {}) {
  negroActivo = activo;
  if (MODO === 'proyector') document.getElementById('negro').hidden = !activo;
  document.querySelector('[data-accion="negro"]')?.setAttribute('aria-pressed', String(activo));
  if (emitir) enviar({ tipo: 'negro', activo });
}

// ---------- Sincronía proyector ↔ presentador ----------
// postMessage funciona incluso abriendo el archivo directo (file://);
// BroadcastChannel cubre el caso de servirlo con python -m http.server.

let canal = null;
try {
  canal = new BroadcastChannel('charla1-deck');
  canal.onmessage = (evento) => recibir(evento.data);
} catch {
  canal = null;
}
const vistos = new Set();

function enviar(mensaje) {
  const completo = { fuente: 'charla1', id: `${Date.now()}-${Math.random()}`, ...mensaje };
  vistos.add(completo.id);
  canal?.postMessage(completo);
  const destino = MODO === 'presentador' ? window.opener : ventanaPresentador;
  if (destino && !destino.closed) destino.postMessage(completo, '*');
}

function recibir(mensaje) {
  if (mensaje?.fuente !== 'charla1' || vistos.has(mensaje.id)) return;
  vistos.add(mensaje.id);
  if (mensaje.tipo === 'ir') ir(mensaje.indice, { emitir: false });
  else if (mensaje.tipo === 'cronometro') aplicarCronometro(mensaje.indice, mensaje.restante, mensaje.fin);
  else if (mensaje.tipo === 'negro') aplicarNegro(mensaje.activo, { emitir: false });
  else if (mensaje.tipo === 'hola' && MODO === 'proyector') enviar({ tipo: 'ir', indice: actual });
}

window.addEventListener('message', (evento) => recibir(evento.data));

// ---------- Vista de presentador ----------

function abrirPresentador() {
  if (MODO !== 'proyector') return;
  ventanaPresentador = window.open(`${location.pathname}?presentador#${actual + 1}`, 'presentador-charla1', 'popup,width=1280,height=800');
}

function construirPresentador() {
  document.body.insertAdjacentHTML('afterbegin', `
    <div id="presentador">
      <header class="pres-cabecera">
        <div class="pres-titulo"></div>
        <div class="dato" id="pres-plan">Plan de esta slide<b></b></div>
        <div class="dato" id="pres-transcurrido">Transcurrido<b>0:00</b></div>
        <div class="dato" id="pres-hora">Hora<b></b></div>
      </header>
      <div class="pres-actual"></div>
      <div class="pres-lateral">
        <div class="pres-siguiente"><small>Siguiente</small><div class="pres-miniatura"><div class="mini"></div></div></div>
        <div class="pres-notas"><small>Notas</small><div class="contenido"></div></div>
      </div>
      <div class="pres-controles">
        <button data-accion="anterior">◀ Anterior</button>
        <button data-accion="siguiente">Siguiente ▶</button>
        <button data-accion="cronometro">Cronómetro<kbd>C</kbd></button>
        <button data-accion="reloj">Reiniciar reloj<kbd>R</kbd></button>
        <button data-accion="negro" aria-pressed="false">Pantalla negra<kbd>B</kbd></button>
      </div>
    </div>`);
  document.querySelector('.pres-actual').append(escenario);
  const acciones = {
    anterior: () => ir(actual - 1),
    siguiente: () => ir(actual + 1),
    cronometro: () => alternarCronometro(actual),
    reloj: reiniciarReloj,
    negro: () => aplicarNegro(!negroActivo),
  };
  document.querySelectorAll('.pres-controles button').forEach((boton) => {
    boton.addEventListener('click', () => {
      acciones[boton.dataset.accion]();
      boton.blur(); // para que la barra espaciadora no vuelva a pulsar el botón
    });
  });
  new ResizeObserver(escalar).observe(document.querySelector('.pres-actual'));
  setInterval(actualizarReloj, 500);
}

function actualizarPresentador() {
  const slide = slides[actual];
  document.querySelector('.pres-titulo').textContent = `${actual + 1} / ${slides.length} · ${slide.dataset.titulo}`;
  document.querySelector('.pres-notas .contenido').innerHTML = slide.querySelector('.notas')?.innerHTML ?? '';
  const mini = document.querySelector('.pres-miniatura .mini');
  const siguiente = slides[actual + 1];
  mini.replaceChildren(siguiente ? clonarParaMiniatura(siguiente) : '');
  escalarMiniatura();
  actualizarReloj();
}

function clonarParaMiniatura(slide) {
  const clon = slide.cloneNode(true);
  clon.classList.add('activa');
  clon.querySelectorAll('[style]').forEach((el) => {
    el.style.opacity = '';
    el.style.visibility = '';
    el.style.transform = '';
  });
  const originales = slide.querySelectorAll('canvas');
  clon.querySelectorAll('canvas').forEach((lienzo, i) => {
    const imagen = new Image();
    imagen.src = originales[i].toDataURL();
    imagen.style.cssText = 'width:100%;height:100%';
    lienzo.replaceWith(imagen);
  });
  return clon;
}

function escalarMiniatura() {
  const caja = document.querySelector('.pres-miniatura');
  caja.querySelector('.mini').style.transform = `scale(${caja.clientWidth / 1920})`;
}

function leerInicio() {
  try {
    return Number(localStorage.getItem('charla1-inicio')) || null;
  } catch {
    return null;
  }
}

function reiniciarReloj() {
  inicioCharla = Date.now();
  try {
    localStorage.setItem('charla1-inicio', String(inicioCharla));
  } catch {
    // sin almacenamiento: el reloj funciona igual mientras la ventana siga abierta
  }
  actualizarReloj();
}

const formatoMinuto = (minutos) => `${Math.floor(minutos)}:${String(Math.round((minutos % 1) * 60)).padStart(2, '0')}`;

function actualizarReloj() {
  if (MODO !== 'presentador' || actual < 0) return;
  const desde = Number(slides[actual].dataset.minuto);
  const hasta = Number(slides[actual + 1]?.dataset.minuto ?? MINUTOS_CHARLA);
  const transcurrido = inicioCharla ? (Date.now() - inicioCharla) / 60000 : 0;
  document.querySelector('#pres-plan b').textContent = `${formatoMinuto(desde)} – ${formatoMinuto(hasta)}`;
  const dato = document.getElementById('pres-transcurrido');
  dato.querySelector('b').textContent = formatoMinuto(Math.floor(transcurrido * 60) / 60);
  dato.classList.toggle('atrasado', inicioCharla !== null && transcurrido > hasta + 0.5);
  dato.classList.toggle('adelantado', inicioCharla !== null && transcurrido < desde - 1);
  document.querySelector('#pres-hora b').textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

// ---------- QR, pies e impresión ----------

function pintarQR() {
  document.querySelectorAll('[data-qr]').forEach((caja) => {
    const url = CONFIG[caja.dataset.qr]?.url;
    if (!url) {
      caja.innerHTML = `<div class="qr-pendiente">Falta la URL<code>CONFIG.${caja.dataset.qr}.url</code></div>`;
      return;
    }
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    caja.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  });
  document.querySelectorAll('[data-qr-texto]').forEach((parrafo) => {
    const texto = CONFIG[parrafo.dataset.qrTexto]?.texto;
    if (!texto) return;
    parrafo.textContent = texto;
    parrafo.classList.add('url');
  });
}

function agregarPies() {
  slides.forEach((slide, indice) => {
    if (slide.hasAttribute('data-sin-pie')) return;
    slide.insertAdjacentHTML('beforeend',
      `<footer class="pie-slide"><span>Investigar mercados con Gemini · Charla 1</span><span>${indice + 1} / ${slides.length}</span></footer>`);
  });
}

function prepararImpresion() {
  raiz.classList.add('modo-impresion');
  slides.forEach((slide) => {
    const animados = slide.querySelectorAll('[data-animar], .letra, .conector, .por-que');
    gsap.killTweensOf(animados);
    gsap.set(animados, { clearProps: 'opacity,visibility,transform' });
  });
  graficos.forEach((grafico) => {
    grafico.options.animation = false;
    grafico.resize();
    grafico.update('none');
  });
}

function despuesDeImprimir() {
  if (MODO === 'imprimir') return;
  raiz.classList.remove('modo-impresion');
  graficos.forEach((grafico) => {
    grafico.options.animation = SIN_MOVIMIENTO ? false : ANIMACION_GRAFICOS;
    grafico.resize();
  });
}

addEventListener('beforeprint', prepararImpresion);
addEventListener('afterprint', despuesDeImprimir);

// ---------- Inicio ----------

async function iniciar() {
  agregarPies();
  prepararCronometros();
  pintarQR();
  if (MODO === 'imprimir') raiz.classList.add('modo-impresion');
  if (MODO === 'presentador') {
    raiz.classList.add('modo-presentador');
    construirPresentador();
  }
  escalar();
  addEventListener('resize', escalar);

  await Promise.all([document.fonts.load('700 24px Jakarta'), document.fonts.load('24px Mono')]).catch(() => {});
  crearGraficos();

  const inicial = Number.parseInt(location.hash.slice(1), 10) - 1;
  ir(Number.isNaN(inicial) ? 0 : inicial, { emitir: false });
  if (MODO === 'presentador') enviar({ tipo: 'hola' });
  setTimeout(() => document.getElementById('ayuda').classList.add('oculta'), 5000);
}

iniciar();
