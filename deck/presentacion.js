/* Deck de la charla 1. No necesita compilar ni internet: GSAP (con SplitText y Flip),
   Chart.js y qrcode-generator están en vendor/ y las fuentes en fuentes/.
   Atajos: ←/→ o clicker, F pantalla completa, P vista de presentador,
   C cronómetro de la slide (Shift+C lo reinicia), B pantalla negra, R reinicia el reloj (presentador).
   En las slides con pasos (data-paso), → revela el siguiente bloque antes de pasar de slide.
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
// Sin GSAP (o al imprimir, o con movimiento reducido) el CSS ya muestra cada slide completa.
const SIN_MOVIMIENTO = MODO === 'imprimir' || matchMedia('(prefers-reduced-motion: reduce)').matches || !window.gsap;
// Muchas slides no tienen pasos ni contadores: animar una lista vacía es normal aquí.
if (window.gsap) gsap.config({ nullTargetWarn: false });

const raiz = document.documentElement;
const escenario = document.getElementById('escenario');
const slides = [...escenario.querySelectorAll('.slide')];
const graficos = new Map(); // canvas -> instancia de Chart
const cronometros = new Map(); // índice de slide -> estado del cronómetro
let actual = -1;
let pasoActual = 0; // clics ya dados en la slide actual (0 = solo la entrada)
let lineas = []; // timelines de GSAP de la slide actual, una por paso mostrado
let inicioEntrada = 0; // en el reloj de GSAP: cuándo empieza a entrar la slide actual
let ambiente = null; // movimiento lento de los orbes de la portada
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

function ir(indice, { paso = 0, emitir = true } = {}) {
  indice = Math.max(0, Math.min(slides.length - 1, indice));
  if (indice === actual) {
    irAPaso(paso, { emitir });
    return;
  }
  const direccion = indice > actual ? 1 : -1;
  if (actual >= 0) salir(slides[actual], direccion);
  // La slide nueva entra cuando la anterior ya salió: si se cruzan, sus textos se enciman.
  if (!SIN_MOVIMIENTO) inicioEntrada = gsap.globalTimeline.time() + (actual >= 0 ? DURACION_SALIDA : 0);
  actual = indice;
  const slide = slides[actual];
  if (!SIN_MOVIMIENTO) gsap.killTweensOf(slide); // por si todavía estaba saliendo
  slide.classList.remove('saliendo');
  slide.classList.add('activa');
  pasoActual = Math.min(paso, totalPasos(slide) - 1);
  // Al avanzar, la slide se arma desde su entrada; al retroceder aparece tal como se dejó.
  montar(slide, pasoActual, { instantaneo: direccion < 0 });
  entrar(slide, direccion);
  ambiente?.paused(!slide.classList.contains('portada'));
  document.querySelector('#progreso span').style.width = `${((actual + 1) / slides.length) * 100}%`;
  history.replaceState(null, '', `#${actual + 1}`);
  if (emitir) enviar({ tipo: 'ir', indice: actual, paso: pasoActual });
  if (MODO === 'presentador') {
    if (!inicioCharla && actual > 0) reiniciarReloj();
    actualizarPresentador();
  }
}

function irAPaso(paso, { emitir = true } = {}) {
  const slide = slides[actual];
  paso = Math.max(0, Math.min(totalPasos(slide) - 1, paso));
  if (paso === pasoActual) return;
  if (paso === pasoActual + 1) {
    lineas.forEach((tl) => tl.progress(1)); // termina lo que seguía en curso antes de seguir
    lineas.push(construirPaso(slide, paso, esperaEntrada()));
  } else {
    montar(slide, paso, { instantaneo: true });
  }
  pasoActual = paso;
  if (emitir) enviar({ tipo: 'ir', indice: actual, paso });
  if (MODO === 'presentador') actualizarPresentador();
}

function avanzar() {
  if (pasoActual < totalPasos(slides[actual]) - 1) irAPaso(pasoActual + 1);
  else ir(actual + 1);
}

function retroceder() {
  if (pasoActual > 0) irAPaso(pasoActual - 1);
  else ir(actual - 1, { paso: Infinity });
}

const TECLAS_SIGUIENTE = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
const TECLAS_ANTERIOR = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

document.addEventListener('keydown', (evento) => {
  if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
  const tecla = evento.key.length === 1 ? evento.key.toLowerCase() : evento.key;
  if (TECLAS_SIGUIENTE.includes(tecla)) avanzar();
  else if (TECLAS_ANTERIOR.includes(tecla)) retroceder();
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

// ---------- Escenas y pasos ----------
// El CSS define el estado final de cada slide y GSAP solo anima desde el inicial.
// Un elemento con data-paso="n" aparece en el clic n; los [data-animar] sin data-paso, al entrar.
// El valor de data-animar elige el efecto (ver EFECTOS); los títulos entran palabra por palabra.

const PROPIEDADES_ANIMADAS = 'opacity,visibility,transform,clipPath,boxShadow,backgroundColor,borderColor';

const totalPasos = (slide) => SIN_MOVIMIENTO
  ? 1
  : 1 + Math.max(0, ...[...slide.querySelectorAll('[data-paso]')].map((el) => Number(el.dataset.paso)));

const DURACION_SALIDA = 0.3;

// Segundos que faltan para que la slide actual empiece a entrar (la anterior aún está saliendo).
const esperaEntrada = () => SIN_MOVIMIENTO ? 0 : Math.max(0, inicioEntrada - gsap.globalTimeline.time());

function entrar(slide, direccion) {
  if (SIN_MOVIMIENTO) return;
  gsap.fromTo(slide, { x: 80 * direccion, autoAlpha: 0 }, {
    x: 0, autoAlpha: 1, duration: 0.5, delay: esperaEntrada(), ease: 'power2.out',
    clearProps: 'opacity,visibility,transform',
  });
}

function salir(slide, direccion) {
  lineas.forEach((tl) => tl.kill());
  lineas = [];
  slide.classList.remove('activa');
  if (SIN_MOVIMIENTO) return;
  slide.classList.add('saliendo');
  // Sale desde donde esté: si aún no terminaba de entrar, no reaparece de golpe.
  gsap.killTweensOf(slide);
  gsap.to(slide, {
    x: -60 * direccion, autoAlpha: 0, duration: DURACION_SALIDA, ease: 'power2.in',
    onComplete: () => {
      slide.classList.remove('saliendo');
      limpiar(slide);
      mostrarFinal(slide);
      // La miniatura del presentador puede ser esta misma slide: ahora ya está completa.
      if (MODO === 'presentador') actualizarMiniatura();
    },
  });
}

// Deja la slide en su estado inicial y aplica los pasos 0..hasta (el último animado, salvo instantaneo).
function montar(slide, hasta, { instantaneo = false } = {}) {
  lineas.forEach((tl) => tl.kill());
  lineas = [];
  if (SIN_MOVIMIENTO) return;
  mostrarFinal(slide);
  preparar(slide);
  for (let n = 0; n <= hasta; n++) {
    const tl = construirPaso(slide, n, esperaEntrada());
    if (instantaneo || n < hasta) tl.progress(1);
    lineas.push(tl);
  }
  if (instantaneo) completarGraficos(slide);
}

function preparar(slide) {
  gsap.set(slide.querySelectorAll('[data-paso]'), { autoAlpha: 0 });
  slide.querySelectorAll('[data-contar]').forEach((el) => {
    el.textContent = formatoNumero(el.dataset.final).mostrar(Number(el.dataset.desde ?? 0));
  });
  slide.querySelectorAll('[data-animar="escribir"]').forEach((el) => { el.textContent = ''; });
  ESCENAS[slide.dataset.animacion]?.preparar?.(slide);
}

function construirPaso(slide, n, espera = 0) {
  const tl = gsap.timeline({ delay: espera });
  const escena = ESCENAS[slide.dataset.animacion];
  const propia = n === 0 ? escena?.entrada : escena?.pasos?.[n];
  // La escena puede retrasar el resto del paso (por ejemplo, para que primero avance el conector).
  const inicio = propia?.(slide, tl) ?? (n === 0 ? 0.15 : 0);
  const separacion = n === 0 ? 0.08 : 0.14;
  const elementos = slide.querySelectorAll(n === 0 ? '[data-animar]:not([data-paso])' : `[data-paso="${n}"]`);
  elementos.forEach((el, i) => tl.add(revelar(el), inicio + i * separacion));
  return tl;
}

// Palabras de SplitText que pertenecen a este elemento y no a un hijo que entra en otro paso.
const palabrasPropias = (el) => [...el.querySelectorAll('.palabra')]
  .filter((palabra) => palabra.parentElement.closest('[data-paso], [data-animar]') === el);

function revelar(el) {
  const tl = gsap.timeline().set(el, { autoAlpha: 1 }, 0);
  const palabras = palabrasPropias(el);
  if (palabras.length) {
    tl.fromTo(palabras, { yPercent: 115 }, { yPercent: 0, duration: 0.75, ease: 'power3.out', stagger: 0.035 }, 0);
  } else {
    tl.add((EFECTOS[el.dataset.animar] ?? EFECTOS.subir)(el), 0);
  }
  const contadores = el.matches('[data-contar]') ? [el] : el.querySelectorAll('[data-contar]');
  contadores.forEach((contador) => tl.add(contar(contador), 0.2));
  return tl;
}

const EFECTOS = {
  subir: (el) => gsap.fromTo(el, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' }),
  pop: (el) => gsap.fromTo(el, { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(2.2)' }),
  barrido: (el) => gsap.fromTo(el, { clipPath: 'inset(0% 100% 0% 0%)' },
    { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'power3.inOut' }),
  hijos: (el) => gsap.fromTo(el.children, { autoAlpha: 0, y: 18, scale: 0.85 },
    { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(1.8)', stagger: { each: 0.07, grid: 'auto' } }),
  // Entra como las demás y luego se eleva con un resplandor de acento (estado final en el CSS).
  destacar: (el) => gsap.timeline()
    .fromTo(el, { autoAlpha: 0, y: 28, boxShadow: '0 0px 0px 0px rgba(48, 71, 240, 0)' },
      { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' })
    .to(el, { y: -10, boxShadow: '0 34px 70px -30px rgba(48, 71, 240, 0.65)', duration: 0.7, ease: 'power2.out' }, '+=0.2'),
  parte: (el) => gsap.timeline()
    .fromTo(el, { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, duration: 0.5, ease: 'power3.out' })
    .fromTo(el.querySelector('i'), { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)' }, 0.1),
  escribir,
};

// Escribe el texto letra por letra con un cursor; el alto ya está fijado para que nada salte.
function escribir(el) {
  const texto = el.dataset.final;
  const estado = { letras: 0 };
  return gsap.timeline()
    .call(() => el.classList.add('escribiendo'), null, 0)
    .to(estado, {
      letras: texto.length, duration: texto.length * 0.03, ease: 'none',
      onUpdate: () => { el.textContent = texto.slice(0, Math.round(estado.letras)); },
    }, 0.35);
}

// "4,988", "×3.7" o "−55 %": separa prefijo, número y sufijo para contar sin cambiar el formato.
function formatoNumero(texto) {
  const [, prefijo, numero, sufijo] = texto.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s);
  const decimales = numero.split('.')[1]?.length ?? 0;
  const formato = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: numero.includes(','),
  });
  return { valor: Number(numero.replaceAll(',', '')), mostrar: (valor) => prefijo + formato.format(valor) + sufijo };
}

function contar(el) {
  const { valor, mostrar } = formatoNumero(el.dataset.final);
  const estado = { valor: Number(el.dataset.desde ?? 0) };
  return gsap.to(estado, {
    valor, duration: 1.4, ease: 'power2.out',
    onUpdate: () => { el.textContent = mostrar(estado.valor); },
  });
}

const popNumero = (paso) => gsap.fromTo(paso.querySelector('.numero'), { scale: 0.3 },
  { scale: 1, duration: 0.6, ease: 'back.out(2.4)' });

const ESCENAS = {
  portada: {
    entrada(slide, tl) {
      tl.fromTo(slide.querySelector('.caso svg'), { rotation: -120, scale: 0.4 },
        { rotation: 0, scale: 1, duration: 1.1, ease: 'back.out(1.6)' }, 0.5);
    },
  },
  tikay: {
    // Los pétalos crecen desde el centro de la flor (la base de cada elipse).
    // El origen va en el estado inicial y sin smoothOrigin: si no, GSAP deja los pétalos desplazados.
    entrada(slide, tl) {
      tl.fromTo(slide.querySelector('.flor'), { rotation: -50 }, { rotation: 0, duration: 1.4, ease: 'power3.out' }, 0.2)
        .fromTo(slide.querySelector('.flor .centro'), { scale: 0, transformOrigin: '50% 50%', smoothOrigin: false },
          { scale: 1, duration: 0.5, ease: 'back.out(3)' }, 0.2)
        .fromTo(slide.querySelectorAll('.flor .petalo'), { scale: 0, transformOrigin: '50% 100%', smoothOrigin: false },
          { scale: 1, duration: 0.7, ease: 'back.out(1.7)', stagger: 0.09 }, 0.3);
    },
  },
  problema: {
    preparar(slide) {
      slide.querySelectorAll('canvas').forEach((lienzo) => {
        const grafico = graficos.get(lienzo);
        grafico.$capas = { etiquetas: 0, anotacion: 0 };
        grafico.update('reset');
      });
    },
    entrada(slide, tl) {
      dibujarGrafico(tl, slide.querySelector('#grafico-ventas'), 0.6);
    },
    pasos: {
      1(slide, tl) {
        dibujarGrafico(tl, slide.querySelector('#grafico-recompra'), 0.45);
      },
    },
  },
  proceso: {
    preparar(slide) {
      gsap.set(slide.querySelectorAll('.conector-avance, .conector-pendiente'), { scaleX: 0 });
    },
    entrada(slide, tl) {
      tl.add(popNumero(slide.querySelector('.paso')), 0.4);
    },
    // Cada clic: primero avanza el conector y, cuando llega, aparece el paso.
    pasos: {
      1(slide, tl) {
        tl.fromTo(slide.querySelector('.conector-avance'), { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.inOut' }, 0)
          .add(popNumero(slide.querySelector('.paso[data-paso="1"]')), 0.6);
        return 0.5;
      },
      2(slide, tl) {
        tl.fromTo(slide.querySelector('.conector-pendiente'), { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.inOut' }, 0)
          .add(popNumero(slide.querySelector('.paso[data-paso="2"]')), 0.6);
        return 0.5;
      },
    },
  },
  crear: {
    preparar(slide) {
      slide.querySelector('.letras').classList.add('armando');
    },
    entrada(slide, tl) {
      tl.fromTo(slide.querySelectorAll('.letra b'), { autoAlpha: 0, y: 60, scale: 0.6 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.12, ease: 'back.out(1.8)' }, 0.45);
    },
    pasos: {
      // Las letras grandes viajan a sus tarjetas (Flip) y aparecen sus nombres y descripciones.
      1(slide, tl) {
        const letras = slide.querySelector('.letras');
        const estado = Flip.getState(letras.querySelectorAll('.letra b'));
        letras.classList.remove('armando');
        gsap.set(letras.querySelectorAll('.letra.clave'), { boxShadow: 'none' }); // su anillo llega en el clic 2
        tl.add(Flip.from(estado, { duration: 0.9, ease: 'power3.inOut', stagger: 0.04, scale: true }), 0)
          .from(letras.querySelectorAll('.letra'), { backgroundColor: 'rgba(255, 255, 255, 0)', borderColor: 'rgba(227, 223, 214, 0)', duration: 0.5 }, 0.55)
          .fromTo(letras.querySelectorAll('.letra h3, .letra p'), { autoAlpha: 0, y: 16 },
            { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.04, ease: 'power3.out' }, 0.7);
        return 1;
      },
      2(slide, tl) {
        const claves = slide.querySelectorAll('.letra.clave');
        tl.fromTo(claves, { boxShadow: '0 0 0 0px rgba(0, 0, 0, 0)' }, {
          boxShadow: (_i, el) => `0 0 0 4px ${getComputedStyle(el).getPropertyValue('--color').trim()}`,
          duration: 0.5, ease: 'power2.out',
        }, 0)
          .fromTo(claves, { scale: 1 }, { scale: 1.04, duration: 0.25, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0);
      },
    },
  },
  cierre: {
    // Los QR se materializan módulo a módulo, desde el centro hacia afuera.
    entrada(slide, tl) {
      slide.querySelectorAll('.qr .codigo').forEach((codigo, i) => {
        const n = Number(codigo.dataset.modulos);
        const modulos = codigo.querySelectorAll('rect');
        if (!modulos.length) return;
        const radio = n / Math.SQRT2;
        tl.fromTo(modulos, { autoAlpha: 0 }, {
          autoAlpha: 1, duration: 0.2, ease: 'none',
          stagger: (_j, rect) => (Math.hypot(rect.x.baseVal.value - n / 2, rect.y.baseVal.value - n / 2) / radio) * 1.1,
        }, 0.7 + i * 0.25);
      });
    },
  },
};

// Quita lo que dejó GSAP y muestra la slide completa: al salir, al imprimir y en la miniatura.
function mostrarFinal(contenedor) {
  limpiar(contenedor.querySelectorAll('[style]:not(.orbe)'));
  contenedor.querySelectorAll('.armando').forEach((el) => el.classList.remove('armando'));
  contenedor.querySelectorAll('.escribiendo').forEach((el) => el.classList.remove('escribiendo'));
  contenedor.querySelectorAll('[data-final]').forEach((el) => { el.textContent = el.dataset.final; });
  finalizarGraficos(contenedor);
}

function finalizarGraficos(contenedor) {
  contenedor.querySelectorAll('canvas').forEach((lienzo) => {
    const grafico = graficos.get(lienzo);
    if (!grafico) return;
    grafico.$capas = { etiquetas: 1, anotacion: 1 };
    grafico.stop();
    // Recién creado, Chart.js lo mide con la escala del escenario; aquí va el tamaño real, sin escalar.
    grafico.resize(lienzo.parentElement.clientWidth, lienzo.parentElement.clientHeight);
    grafico.update('none');
  });
}

function limpiar(elementos) {
  if (window.gsap) gsap.set(elementos, { clearProps: PROPIEDADES_ANIMADAS });
}

function completarGraficos(slide) {
  slide.querySelectorAll('canvas').forEach((lienzo) => {
    const grafico = graficos.get(lienzo);
    grafico?.stop();
    grafico?.update('none');
  });
}

// Los títulos se dividen en palabras una sola vez, ya con las fuentes cargadas.
function dividirTextos() {
  if (SIN_MOVIMIENTO || !window.SplitText) return;
  document.querySelectorAll('.slide .titulo, .slide .mensaje-clave').forEach((el) => {
    SplitText.create(el, { type: 'words', mask: 'words', wordsClass: 'palabra', tag: 'span' });
  });
}

// Guarda el texto final de contadores y textos escritos; fija el alto de estos últimos.
function guardarTextosFinales() {
  document.querySelectorAll('[data-contar], [data-animar="escribir"]').forEach((el) => {
    el.dataset.final = el.textContent.trim();
  });
  if (SIN_MOVIMIENTO) return;
  document.querySelectorAll('[data-animar="escribir"]').forEach((el) => { el.style.minHeight = `${el.offsetHeight}px`; });
}

function prepararAmbiente() {
  if (SIN_MOVIMIENTO) return;
  ambiente = gsap.timeline({ paused: true });
  const recorridos = [{ x: 70, y: 50 }, { x: -60, y: -40 }, { x: 50, y: -60 }];
  document.querySelectorAll('.portada .orbe').forEach((orbe, i) => {
    ambiente.to(orbe, { ...recorridos[i], scale: 1.12, duration: 9 + i * 1.5, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
  });
}

// ---------- Gráficos ----------

// Las capas que GSAP anima (etiquetas y anotación) viven en la instancia y no en las opciones,
// porque Chart.js guarda en caché las opciones ya resueltas de cada plugin.
const capa = (grafico, nombre) => grafico.$capas?.[nombre] ?? 1;

// Etiqueta solo los puntos que cuentan la historia (inicio y punto clave).
const etiquetasDirectas = {
  id: 'etiquetasDirectas',
  afterDatasetsDraw(grafico, _argumentos, opciones) {
    const alfa = capa(grafico, 'etiquetas');
    if (alfa <= 0) return;
    const { ctx } = grafico;
    const puntos = grafico.getDatasetMeta(0).data;
    ctx.save();
    ctx.globalAlpha = alfa;
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

// Línea punteada al nivel inicial y flecha hasta el punto clave: dibuja la caída.
const anotacionCaida = {
  id: 'anotacionCaida',
  afterDatasetsDraw(grafico, _argumentos, opciones) {
    const progreso = capa(grafico, 'anotacion');
    if (progreso <= 0) return;
    const { ctx } = grafico;
    const puntos = grafico.getDatasetMeta(0).data;
    const x0 = puntos[opciones.desde].x + 20;
    const x1 = puntos[opciones.hasta].x;
    const y0 = puntos[opciones.desde].y;
    const y1 = puntos[opciones.hasta].y - 18;
    const guia = Math.min(1, progreso / 0.5);
    const flecha = Math.max(0, (progreso - 0.5) / 0.5);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = opciones.colorGuia;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (x1 - x0) * guia, y0);
    ctx.stroke();
    if (flecha > 0) {
      const y = y0 + (y1 - y0) * flecha;
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = opciones.color;
      ctx.fillStyle = opciones.color;
      ctx.beginPath();
      ctx.moveTo(x1, y0);
      ctx.lineTo(x1, y - 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1 - 11, y - 14);
      ctx.lineTo(x1, y);
      ctx.lineTo(x1 + 11, y - 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
};

// Las barras crecen una tras otra y la línea se dibuja punto por punto, salvo al pasar
// el mouse o al redimensionar.
const RETRASO_BARRA = 140; // ms
const DURACION_BARRA = 700; // ms
const PASO_LINEA = 230; // ms entre punto y punto
const conRetraso = (contexto) => contexto.type === 'data' && contexto.mode !== 'active' && contexto.mode !== 'resize';
const yAnterior = (contexto) => (contexto.index === 0
  ? contexto.chart.scales.y.getPixelForValue(contexto.raw)
  : contexto.chart.getDatasetMeta(contexto.datasetIndex).data[contexto.index - 1].getProps(['y'], true).y);
const retrasoPunto = (contexto) => (conRetraso(contexto) ? contexto.index * PASO_LINEA : 0);

function crearGraficos() {
  const estilo = getComputedStyle(raiz);
  const color = (variable) => estilo.getPropertyValue(variable).trim();
  Chart.defaults.font.family = 'Jakarta';
  Chart.defaults.font.size = 22;
  Chart.defaults.color = color('--suave');

  const opciones = ({ maximo, paso, formatoEje, indices, posiciones, formato, animacion, extra }) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: SIN_MOVIMIENTO ? false : animacion,
    transitions: { active: { animation: { duration: 0 } } },
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
      ...extra,
    },
  });

  const lienzoVentas = document.getElementById('grafico-ventas');
  const ventas = new Chart(lienzoVentas, {
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
      animacion: {
        duration: DURACION_BARRA, easing: 'easeOutQuart',
        delay: (contexto) => (conRetraso(contexto) ? contexto.dataIndex * RETRASO_BARRA : 0),
      },
    }),
  });
  ventas.$duracion = ((DATOS.ventasMiles.length - 1) * RETRASO_BARRA + DURACION_BARRA) / 1000;
  graficos.set(lienzoVentas, ventas);

  const caida = color('--caida');
  const lienzoRecompra = document.getElementById('grafico-recompra');
  const recompra = new Chart(lienzoRecompra, {
    type: 'line',
    plugins: [anotacionCaida, etiquetasDirectas],
    data: {
      labels: DATOS.ejes,
      datasets: [{
        data: DATOS.recompra90,
        borderColor: caida,
        borderWidth: 3,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: caida,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        spanGaps: false,
        fill: 'origin',
        // Un velo del mismo color que se desvanece hacia el eje: acompaña la caída sin taparla.
        backgroundColor: ({ chart }) => {
          if (!chart.chartArea) return 'transparent';
          const degradado = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
          degradado.addColorStop(0, 'rgba(226, 82, 43, 0.16)');
          degradado.addColorStop(1, 'rgba(226, 82, 43, 0)');
          return degradado;
        },
      }],
    },
    options: opciones({
      maximo: 30, paso: 10, formatoEje: (valor) => `${valor} %`,
      indices: [0, 5], posiciones: ['arriba', 'abajo'], formato: (valor) => `${valor.toFixed(1)} %`,
      animacion: {
        x: { type: 'number', easing: 'linear', duration: PASO_LINEA, from: NaN, delay: retrasoPunto },
        y: { type: 'number', easing: 'linear', duration: PASO_LINEA, from: yAnterior, delay: retrasoPunto },
      },
      extra: { anotacionCaida: { desde: 0, hasta: 5, color: caida, colorGuia: color('--tenue') } },
    }),
  });
  recompra.$duracion = (DATOS.recompra90.filter((valor) => valor !== null).length * PASO_LINEA) / 1000;
  graficos.set(lienzoRecompra, recompra);

  graficos.forEach((grafico) => { grafico.$animacion = grafico.options.animation; });
}

// Dibuja el gráfico desde cero y, cuando termina, hace aparecer sus etiquetas y su anotación.
function dibujarGrafico(tl, lienzo, inicio) {
  const grafico = graficos.get(lienzo);
  const redibujar = () => grafico.draw();
  tl.call(() => {
    grafico.update('reset');
    grafico.update();
  }, null, inicio)
    .to(grafico.$capas, { etiquetas: 1, duration: 0.4, onUpdate: redibujar }, inicio + grafico.$duracion)
    .to(grafico.$capas, { anotacion: 1, duration: 1, ease: 'power2.inOut', onUpdate: redibujar }, '>');
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
  // Aviso en ámbar: el último minuto, o el último 20 % en los cronómetros cortos.
  estado.el.classList.toggle('ultimo-minuto', restante > 0 && restante <= Math.min(60000, estado.total * 0.2));
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
  if (mensaje.tipo === 'ir') ir(mensaje.indice, { paso: mensaje.paso ?? 0, emitir: false });
  else if (mensaje.tipo === 'cronometro') aplicarCronometro(mensaje.indice, mensaje.restante, mensaje.fin);
  else if (mensaje.tipo === 'negro') aplicarNegro(mensaje.activo, { emitir: false });
  else if (mensaje.tipo === 'hola' && MODO === 'proyector') enviar({ tipo: 'ir', indice: actual, paso: pasoActual });
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
    anterior: retroceder,
    siguiente: avanzar,
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
  const total = totalPasos(slide);
  const clics = total > 1 ? ` · clics ${pasoActual} de ${total - 1}` : '';
  document.querySelector('.pres-titulo').textContent = `${actual + 1} / ${slides.length} · ${slide.dataset.titulo}${clics}`;
  document.querySelector('.pres-notas .contenido').innerHTML = slide.querySelector('.notas')?.innerHTML ?? '';
  // Si quedan clics, avisa que → todavía no cambia de slide.
  const faltan = total - 1 - pasoActual;
  const rotulo = document.querySelector('.pres-siguiente small');
  rotulo.textContent = faltan > 0 ? `Siguiente slide · faltan ${faltan} ${faltan === 1 ? 'clic' : 'clics'} aquí` : 'Siguiente';
  rotulo.classList.toggle('pendiente', faltan > 0);
  actualizarMiniatura();
  actualizarReloj();
}

function actualizarMiniatura() {
  const mini = document.querySelector('.pres-miniatura .mini');
  const siguiente = slides[actual + 1];
  const clon = siguiente ? clonarParaMiniatura(siguiente) : null;
  mini.replaceChildren(clon ?? '');
  // Se limpia ya dentro del DOM: con un clon suelto, GSAP saca cada elemento para medirlo
  // y al devolverlo deja los espacios entre palabras fuera de su sitio.
  if (clon) mostrarFinal(clon);
  escalarMiniatura();
}

function clonarParaMiniatura(slide) {
  const clon = slide.cloneNode(true);
  clon.classList.remove('saliendo');
  clon.classList.add('activa');
  clon.removeAttribute('style');
  // Recién creados, los gráficos aún se están dibujando y la copia saldría vacía.
  finalizarGraficos(slide);
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

// Un <rect> por módulo (en vez de createSvgTag) para poder animarlos; crispEdges evita
// líneas finas entre módulos vecinos.
function svgQR(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  let modulos = '';
  for (let fila = 0; fila < n; fila++) {
    for (let columna = 0; columna < n; columna++) {
      if (qr.isDark(fila, columna)) modulos += `<rect x="${columna}" y="${fila}" width="1" height="1"/>`;
    }
  }
  return { n, svg: `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">${modulos}</svg>` };
}

function pintarQR() {
  document.querySelectorAll('[data-qr]').forEach((caja) => {
    const url = CONFIG[caja.dataset.qr]?.url;
    if (!url) {
      caja.innerHTML = `<div class="qr-pendiente">Falta la URL<code>CONFIG.${caja.dataset.qr}.url</code></div>`;
      return;
    }
    const { n, svg } = svgQR(url);
    caja.dataset.modulos = n;
    caja.innerHTML = svg;
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
  lineas.forEach((tl) => tl.kill());
  lineas = [];
  slides.forEach((slide) => {
    if (window.gsap) gsap.killTweensOf(slide);
    slide.classList.remove('saliendo');
    limpiar(slide);
    mostrarFinal(slide);
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
    grafico.options.animation = grafico.$animacion;
    grafico.resize();
  });
  // Vuelve al paso en que estaba la slide actual.
  montar(slides[actual], pasoActual, { instantaneo: true });
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
  await document.fonts.ready;
  guardarTextosFinales();
  dividirTextos();
  prepararAmbiente();
  crearGraficos();

  const inicial = Number.parseInt(location.hash.slice(1), 10) - 1;
  ir(Number.isNaN(inicial) ? 0 : inicial, { emitir: false });
  if (MODO === 'presentador') enviar({ tipo: 'hola' });
  setTimeout(() => document.getElementById('ayuda').classList.add('oculta'), 5000);
}

iniciar();
