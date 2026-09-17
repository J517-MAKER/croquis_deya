/* =========================================================
   CROQUIS DEL RECORRIDO DEL TRANSPORTE DE PERSONAL
   Versión 100% gratuita: OpenStreetMap + Leaflet + OSRM.
   No requiere cuenta, tarjeta, facturación ni API Key.

   Este archivo controla todo el comportamiento del mapa:
   - carga el mapa (mosaicos de OpenStreetMap)
   - dibuja los 3 puntos (A, C, B)
   - dibuja la ruta real por calles pasando por A -> C -> B
   - conecta los botones (ir a cada punto, ver todo, abrir en
     Google Maps, imprimir)
   ========================================================= */

/* ---------------------------------------------------------
   1) DATOS DEL RECORRIDO
   Únicamente se usan las coordenadas proporcionadas por el
   usuario. No se inventa ninguna calle ni información extra.
   --------------------------------------------------------- */
const ROUTE_POINTS = {
  A: {
    key: "A",
    label: "A",
    color: "green",
    position: { lat: 25.6402169, lng: -100.1533685 },
    title: "A — Inicio del recorrido",
    description: "Parada donde el trabajador aborda el transporte de personal para dirigirse a su lugar de trabajo.",
  },
  C: {
    key: "C",
    label: "C",
    color: "red",
    position: { lat: 25.64072, lng: -100.15614 },
    title: "C — Punto del accidente",
    description: "Punto aproximado donde ocurrió el accidente durante el recorrido del transporte de personal, debido a un frenón realizado por el conductor.",
    warning: "⚠ Punto del accidente",
  },
  B: {
    key: "B",
    label: "B",
    color: "blue",
    position: { lat: 25.548071, lng: -100.225566 },
    title: "B — Destino final",
    description: "H-E-B El Uro, destino final del recorrido del transporte de personal.",
  },
};

/* Zoom que se usa al centrar el mapa en un solo punto */
const SINGLE_POINT_ZOOM = 17;

/* Servicio público y gratuito de cálculo de rutas por calles
   reales, basado en datos de OpenStreetMap. */
const OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/driving/";

/* Variables que se llenan cuando el mapa termina de cargar */
let map;
let routeLine;
const markers = {}; // guarda los 3 marcadores, por letra

/* ---------------------------------------------------------
   2) FUNCIÓN PRINCIPAL: initMap
   --------------------------------------------------------- */
function initMap() {
  map = L.map("map", {
    center: [ROUTE_POINTS.A.position.lat, ROUTE_POINTS.A.position.lng],
    zoom: 13,
    scrollWheelZoom: true,
  });

  // Capa de mosaicos: gratuita, sin cuenta ni API Key.
  // La atribución de OpenStreetMap es obligatoria por su licencia.
  addTileLayer();

  // Creamos los 3 marcadores personalizados (gota de color + letra)
  Object.values(ROUTE_POINTS).forEach((point) => {
    const marker = L.marker([point.position.lat, point.position.lng], {
      icon: buildCustomPinIcon(point),
      title: point.title,
      alt: point.title,
      riseOnHover: true,
    }).addTo(map);

    marker.bindPopup(buildPopupHtml(point), { maxWidth: 260 });
    markers[point.key] = marker;
  });

  // Ajustamos la vista para que se vean los 3 puntos al iniciar
  fitAllPoints();

  // Dibujamos la ruta real por calles: A -> C -> B
  drawRoute();

  // Conectamos los botones de la interfaz
  setupUIButtons();
}

/* ---------------------------------------------------------
   2b) CAPA DE MOSAICOS
   Ningún proveedor de esta lista requiere cuenta ni API Key.

   Detalle importante: los servidores de openstreetmap.org
   funcionan perfectamente cuando la página se sirve desde un
   dominio real (por ejemplo GitHub Pages), pero bloquean las
   peticiones que llegan al abrir el archivo con doble clic
   (protocolo file://). Por eso, si la página se abre así, se
   usa Esri, que sí lo permite y tampoco pide key.
   --------------------------------------------------------- */
const TILE_PROVIDERS = {
  // Para GitHub Pages o cualquier servidor web (http / https)
  web: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  // Para abrir el archivo directamente desde el disco (file://)
  local: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 19,
      attribution: "Mosaicos &copy; Esri",
    },
  },
};

function addTileLayer() {
  const isLocalFile = window.location.protocol === "file:";
  const provider = isLocalFile ? TILE_PROVIDERS.local : TILE_PROVIDERS.web;

  const layer = L.tileLayer(provider.url, provider.options).addTo(map);

  // Si el proveedor elegido no responde, se prueba con el otro
  let switched = false;
  layer.on("tileerror", () => {
    if (switched) return;
    switched = true;
    console.warn("Proveedor de mosaicos sin respuesta, probando el alterno…");
    map.removeLayer(layer);
    const alternate = isLocalFile ? TILE_PROVIDERS.web : TILE_PROVIDERS.local;
    L.tileLayer(alternate.url, alternate.options).addTo(map);
  });
}

/* ---------------------------------------------------------
   3) CREA EL "PIN" VISUAL (gota de color con una letra)
   Se usa divIcon: un ícono hecho con HTML/CSS propio, con las
   mismas clases .map-pin que ya estaban en styles.css.
   --------------------------------------------------------- */
function buildCustomPinIcon(point) {
  return L.divIcon({
    className: "map-pin-wrapper",
    html: `<div class="map-pin map-pin--${point.color}"><span class="map-pin__label">${point.label}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],   // la punta de la gota queda sobre la coordenada
    popupAnchor: [0, -32],
  });
}

/* ---------------------------------------------------------
   4) CONTENIDO DE LA VENTANA DE INFORMACIÓN (popup)
   --------------------------------------------------------- */
function buildPopupHtml(point) {
  const warningHtml = point.warning
    ? `<p class="warning">${point.warning}</p>`
    : "";

  return `
    <div class="info-window">
      <h4>${point.title}</h4>
      <p>${point.description}</p>
      <p class="coords">Coordenadas: ${point.position.lat}, ${point.position.lng}</p>
      ${warningHtml}
    </div>
  `;
}

/* ---------------------------------------------------------
   5) DIBUJA LA RUTA REAL POR CALLES: A -> C -> B
   OSRM devuelve la geometría de la ruta siguiendo calles
   reales. El punto C va en medio, así que la ruta pasa
   forzosamente por la zona del accidente.
   --------------------------------------------------------- */
async function drawRoute() {
  const status = document.getElementById("route-status");
  setStatus(status, "Calculando la ruta por calles…", "");

  // OSRM espera las coordenadas como longitud,latitud
  const coords = [
    `${ROUTE_POINTS.A.position.lng},${ROUTE_POINTS.A.position.lat}`,
    `${ROUTE_POINTS.C.position.lng},${ROUTE_POINTS.C.position.lat}`,
    `${ROUTE_POINTS.B.position.lng},${ROUTE_POINTS.B.position.lat}`,
  ].join(";");

  const url = `${OSRM_BASE_URL}${coords}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Respuesta HTTP " + response.status);

    const data = await response.json();
    if (data.code !== "Ok" || !data.routes || !data.routes.length) {
      throw new Error("OSRM no devolvió una ruta válida");
    }

    const route = data.routes[0];

    // GeoJSON viene como [lng, lat]; Leaflet necesita [lat, lng]
    const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(latLngs, {
      color: "#0B2545",   // azul oscuro, igual al encabezado
      weight: 5,
      opacity: 0.85,
    }).addTo(map);

    const km = (route.distance / 1000).toFixed(1);
    const min = Math.round(route.duration / 60);
    setStatus(
      status,
      `Ruta por calles A → C → B: ${km} km, aproximadamente ${min} minutos en condiciones normales de tráfico.`,
      ""
    );

    fitAllPoints();
  } catch (error) {
    console.error("No se pudo calcular la ruta A -> C -> B:", error);
    drawFallbackLine();
    setStatus(
      status,
      "No se pudo calcular la ruta por calles (sin conexión o servicio ocupado). Se muestra una línea punteada directa entre los puntos.",
      "route-status--warning"
    );
  }
}

/* Línea punteada de respaldo: une A, C y B en línea directa.
   Se marca como punteada para dejar claro que no es el trazo
   real por calles. */
function drawFallbackLine() {
  const latLngs = [
    [ROUTE_POINTS.A.position.lat, ROUTE_POINTS.A.position.lng],
    [ROUTE_POINTS.C.position.lat, ROUTE_POINTS.C.position.lng],
    [ROUTE_POINTS.B.position.lat, ROUTE_POINTS.B.position.lng],
  ];

  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(latLngs, {
    color: "#0B2545",
    weight: 4,
    opacity: 0.7,
    dashArray: "8 8",
  }).addTo(map);
}

function setStatus(element, text, extraClass) {
  if (!element) return;
  element.textContent = text;
  element.className = "route-status" + (extraClass ? " " + extraClass : "");
}

/* ---------------------------------------------------------
   6) AJUSTA EL ZOOM PARA VER TODO EL RECORRIDO
   --------------------------------------------------------- */
function fitAllPoints() {
  const bounds = L.latLngBounds(
    Object.values(ROUTE_POINTS).map((p) => [p.position.lat, p.position.lng])
  );

  // Si la ruta ya está dibujada, incluimos también su trazo
  if (routeLine) bounds.extend(routeLine.getBounds());

  map.fitBounds(bounds, { padding: [60, 60] });
}

/* ---------------------------------------------------------
   7) CENTRA Y HACE ZOOM SOBRE UN PUNTO ESPECÍFICO
   --------------------------------------------------------- */
function goToPoint(pointKey) {
  const point = ROUTE_POINTS[pointKey];
  map.setView([point.position.lat, point.position.lng], SINGLE_POINT_ZOOM);
  markers[pointKey].openPopup();
}

/* ---------------------------------------------------------
   8) CONEXIÓN DE BOTONES DE LA INTERFAZ
   --------------------------------------------------------- */
function setupUIButtons() {
  document.getElementById("btn-a").addEventListener("click", () => goToPoint("A"));
  document.getElementById("btn-c").addEventListener("click", () => goToPoint("C"));
  document.getElementById("btn-b").addEventListener("click", () => goToPoint("B"));
  document.getElementById("btn-full").addEventListener("click", fitAllPoints);

  document.getElementById("btn-open-gmaps").addEventListener("click", openInGoogleMaps);
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  // Al imprimir, el mapa cambia de tamaño: hay que avisarle a Leaflet
  window.addEventListener("beforeprint", () => map.invalidateSize());
  window.addEventListener("afterprint", () => map.invalidateSize());
}

/* ---------------------------------------------------------
   9) ABRE EL RECORRIDO A -> C -> B EN GOOGLE MAPS (pestaña nueva)
   Esto es solo un enlace: no requiere API Key ni cuenta.
   --------------------------------------------------------- */
function openInGoogleMaps() {
  const origin = `${ROUTE_POINTS.A.position.lat},${ROUTE_POINTS.A.position.lng}`;
  const destination = `${ROUTE_POINTS.B.position.lat},${ROUTE_POINTS.B.position.lng}`;
  const waypoint = `${ROUTE_POINTS.C.position.lat},${ROUTE_POINTS.C.position.lng}`;

  const url =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${origin}` +
    `&destination=${destination}` +
    `&waypoints=${waypoint}` +
    `&travelmode=driving`;

  window.open(url, "_blank");
}

/* ---------------------------------------------------------
   10) ARRANQUE
   --------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", initMap);