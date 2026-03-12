import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  MapPinned,
  Flower2,
  Thermometer,
  Droplets,
  SunMedium,
  X,
  ChevronRight,
  Image as ImageIcon,
  Filter,
  Leaf,
  Mountain,
  Trees,
  SlidersHorizontal,
} from "lucide-react";

/**
 * 植物図鑑アプリ 完成版
 * - 植物データ / 実例写真 / hotspot 管理
 * - Google Sheets CSV / Airtable / local データ読込対応
 * - 植物検索
 * - 実例写真検索（地域 / 撮影地タイプ）
 * - 生育環境検索（数値入力版）
 * - 植物詳細 → 実例写真へ移動
 */

const appConfig = {
  dataSource: {
    // "local" | "sheets" | "airtable"
    type: "sheets",
    sheets: {
      plantsCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTpcm2XxKcaWUyuDVrH3rMMIY9DI82NQq5jU0oCjocaBOqAqE9imOk0BSm2FpMBKLA2rqjRFrZ6acWC/pub?gid=1461147321&single=true&output=csv",
      photosCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTpcm2XxKcaWUyuDVrH3rMMIY9DI82NQq5jU0oCjocaBOqAqE9imOk0BSm2FpMBKLA2rqjRFrZ6acWC/pub?gid=2028478083&single=true&output=csv",
      autoRefreshMs: 60000,
    },
    airtable: {
      baseId: "",
      token: "",
      plantsTable: "Plants",
      photosTable: "Photos",
      useProxy: false,
      proxyBaseUrl: "/api",
    },
  },
};

const REGION_OPTIONS = [
  "北海道",
  "東北",
  "関東",
  "中部",
  "近畿",
  "中国",
  "四国",
  "九州",
  "沖縄",
  "室内可",
];

const FLOWER_COLORS = ["白", "黄", "ピンク", "赤", "紫", "青", "緑", "茶"];
const SOIL_OPTIONS = ["湿地", "林床", "草地", "砂地", "岩場", "高山", "砂礫"];
const MOISTURE_OPTIONS = ["乾燥", "普通", "やや湿潤", "湿潤"];
const PHOTO_LOCATION_OPTIONS = ["川", "山", "海", "庭", "室内", "海外"];

const REGION_MAP_NODES = [
  { id: "北海道", x: 76, y: 12, w: 18, h: 10 },
  { id: "東北", x: 68, y: 26, w: 14, h: 12 },
  { id: "関東", x: 72, y: 40, w: 10, h: 10 },
  { id: "中部", x: 58, y: 38, w: 16, h: 12 },
  { id: "近畿", x: 50, y: 48, w: 10, h: 10 },
  { id: "中国", x: 36, y: 50, w: 14, h: 10 },
  { id: "四国", x: 44, y: 61, w: 10, h: 7 },
  { id: "九州", x: 24, y: 60, w: 14, h: 12 },
  { id: "沖縄", x: 10, y: 86, w: 8, h: 6 },
  { id: "室内可", x: 82, y: 88, w: 14, h: 8 },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] || "").trim();
    });
    return obj;
  });
}

async function loadLocalData() {
  return { plants: SAMPLE_PLANTS, photos: SAMPLE_PHOTOS };
}

async function loadSheetsData() {
  const { plantsCsvUrl, photosCsvUrl } = appConfig.dataSource.sheets;
  if (!plantsCsvUrl || !photosCsvUrl) throw new Error("Google Sheets CSV URL が未設定です");

  const [plantsText, photosText] = await Promise.all([
    fetch(plantsCsvUrl).then((r) => r.text()),
    fetch(photosCsvUrl).then((r) => r.text()),
  ]);

  return {
    plants: parseCsv(plantsText),
    photos: parseCsv(photosText),
  };
}

async function loadAirtableData() {
  const cfg = appConfig.dataSource.airtable;

  if (cfg.useProxy) {
    const [plants, photos] = await Promise.all([
      fetch(`${cfg.proxyBaseUrl}/plants`).then((r) => r.json()),
      fetch(`${cfg.proxyBaseUrl}/photos`).then((r) => r.json()),
    ]);
    return {
      plants: Array.isArray(plants) ? plants : Object.values(plants),
      photos: Array.isArray(photos) ? photos : Object.values(photos),
    };
  }

  if (!cfg.baseId || !cfg.token) throw new Error("Airtable baseId/token が未設定です");

  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
  };

  async function fetchAll(table) {
    let offset = "";
    const records = [];
    do {
      const url = new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(table)}`);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) throw new Error(`${table} の取得に失敗しました`);
      const data = await res.json();
      records.push(...(data.records || []).map((r) => r.fields || {}));
      offset = data.offset || "";
    } while (offset);
    return records;
  }

  const [plants, photos] = await Promise.all([
    fetchAll(cfg.plantsTable),
    fetchAll(cfg.photosTable),
  ]);

  return { plants, photos };
}

function normalizePlant(row) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  return {
    plant_id: row.plant_id || row.id || "",
    japanese_name: row.japanese_name || row.nameJa || "",
    scientific_name: row.scientific_name || row.scientificName || "",
    family: row.family || "",
    genus: row.genus || "",
    plant_type: row.plant_type || row.plantType || "",
    flower_color: row.flower_color || row.flowerColor || "",
    height_cm: num(row.height_cm),
    description: row.description || "",
    flower_start_month: num(row.flower_start_month),
    flower_end_month: num(row.flower_end_month),
    best_view_month: num(row.best_view_month),
    autumn_color_month: num(row.autumn_color_month),
    light_min_lux: num(row.light_min_lux),
    light_max_lux: num(row.light_max_lux),
    temp_min_c: num(row.temp_min_c),
    temp_max_c: num(row.temp_max_c),
    humidity_min_percent: num(row.humidity_min_percent),
    humidity_max_percent: num(row.humidity_max_percent),
    measured_light_lux: num(row.measured_light_lux),
    measured_temp_c: num(row.measured_temp_c),
    measured_humidity_percent: num(row.measured_humidity_percent),
    soil: row.soil || "",
    moisture: row.moisture || "",
    altitude_min_m: num(row.altitude_min_m),
    altitude_max_m: num(row.altitude_max_m),
    region: row.region || "",
    main_image_url: (row.main_image_url || row.mainImageUrl || "").trim(),
    notes: row.notes || row.memo || "",
    search_blob: [
      row.japanese_name || row.nameJa || "",
      row.scientific_name || row.scientificName || "",
      row.family || "",
      row.genus || "",
      row.notes || row.memo || ""
    ].join(" ").toLowerCase(),
  };
}

function normalizePhoto(row) {
  let hotspots = [];
  try {
    hotspots =
      typeof row.hotspots_json === "string"
        ? JSON.parse(row.hotspots_json || "[]")
        : row.hotspots_json || [];
  } catch {
    hotspots = [];
  }
  return {
    photo_id:
      row.photo_id ||
      row.id ||
      (globalThis.crypto?.randomUUID?.() ?? `photo-${Math.random()}`),
    title: row.title || "無題の写真",
    subtitle: row.subtitle || "",
    region: row.region || "",
    location_type: row.location_type || row.location || "",
    image_url: (row.image_url || row.src || "").trim(),
    hotspots,
  };
}

function fmtRange(min, max, unit = "") {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${min}〜${max}${unit}`;
  if (min != null) return `${min}${unit}以上`;
  return `${max}${unit}以下`;
}

function includesMonth(plant, month) {
  if (!month) return true;
  if (!plant.flower_start_month || !plant.flower_end_month) return false;
  return month >= plant.flower_start_month && month <= plant.flower_end_month;
}

function regionMatches(value, selectedRegions) {
  if (!selectedRegions.length) return true;
  const items = String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return selectedRegions.every((r) => items.includes(r));
}

function rangeOverlaps(targetMin, targetMax, filterMin, filterMax) {
  if (filterMin == null && filterMax == null) return true;
  if (targetMin == null && targetMax == null) return false;
  const aMin = targetMin == null ? -Infinity : targetMin;
  const aMax = targetMax == null ? Infinity : targetMax;
  const bMin = filterMin == null ? -Infinity : filterMin;
  const bMax = filterMax == null ? Infinity : filterMax;
  return aMax >= bMin && bMax >= aMin;
}

function normalizeImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  // Google Drive shared file URL
  // https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  const driveFileMatch = raw.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (driveFileMatch) {
    return `https://drive.google.com/thumbnail?id=${driveFileMatch[1]}&sz=w2000`;
  }

  // Google Drive open URL
  // https://drive.google.com/open?id=FILE_ID
  const driveOpenMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (/drive\.google\.com/i.test(raw) && driveOpenMatch) {
    return `https://drive.google.com/thumbnail?id=${driveOpenMatch[1]}&sz=w2000`;
  }

  // Already a thumbnail / direct-ish URL
  if (/drive\.google\.com\/thumbnail/i.test(raw) || /lh3\.googleusercontent\.com/i.test(raw)) {
    return raw;
  }

  return raw;
}

function parseNumInput(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatLastUpdated(date) {
  if (!date) return "未取得";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return String(date);
  }
}

function Info({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="text-sm font-semibold text-slate-800">{value || "—"}</div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-base font-bold text-slate-800">{value}</div>
    </div>
  );
}

function NumberRangeInput({
  label,
  minValue,
  maxValue,
  setMinValue,
  setMaxValue,
  minPlaceholder,
  maxPlaceholder,
  unit,
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-600">{label}</label>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={minValue}
          onChange={(e) => setMinValue(e.target.value)}
          placeholder={minPlaceholder}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
        />
        <span className="text-sm text-slate-400">〜</span>
        <input
          type="number"
          inputMode="decimal"
          value={maxValue}
          onChange={(e) => setMaxValue(e.target.value)}
          placeholder={maxPlaceholder}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
        />
      </div>
      <div className="mt-1 text-xs text-slate-400">{unit}</div>
    </div>
  );
}

export default function PlantEncyclopediaApp() {
  const [plants, setPlants] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [currentPhotoId, setCurrentPhotoId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [selectedPhotoRegions, setSelectedPhotoRegions] = useState([]);
  const [selectedPhotoLocation, setSelectedPhotoLocation] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSoil, setSelectedSoil] = useState("");
  const [selectedMoisture, setSelectedMoisture] = useState("");

  const [luxMinInput, setLuxMinInput] = useState("");
  const [luxMaxInput, setLuxMaxInput] = useState("");
  const [tempMinInput, setTempMinInput] = useState("");
  const [tempMaxInput, setTempMaxInput] = useState("");
  const [humidityMinInput, setHumidityMinInput] = useState("");
  const [humidityMaxInput, setHumidityMaxInput] = useState("");
  const [altitudeMinInput, setAltitudeMinInput] = useState("");
  const [altitudeMaxInput, setAltitudeMaxInput] = useState("");

  const [coordMode, setCoordMode] = useState(false);
  const [coordText, setCoordText] = useState("写真上をクリックすると座標が表示されます。");
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        let raw;
        if (appConfig.dataSource.type === "sheets") raw = await loadSheetsData();
        else if (appConfig.dataSource.type === "airtable") raw = await loadAirtableData();
        else raw = await loadLocalData();

        if (cancelled) return;

        const normalizedPlants = raw.plants.map(normalizePlant).filter((p) => p.plant_id);
        const normalizedPhotos = raw.photos.map(normalizePhoto).filter((p) => p.image_url);

        setPlants(normalizedPlants);
        setPhotos(normalizedPhotos);
        setCurrentPhotoId((prev) => {
          if (prev && normalizedPhotos.some((p) => p.photo_id === prev)) return prev;
          return normalizedPhotos[0]?.photo_id || "";
        });
        setLastUpdatedAt(new Date());
      } catch (e) {
        if (!cancelled) setError(e.message || "データの読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();

    const refreshMs = appConfig.dataSource.sheets.autoRefreshMs || 60000;
    const intervalId =
      appConfig.dataSource.type === "sheets" && refreshMs > 0
        ? window.setInterval(fetchData, refreshMs)
        : null;

    function handleVisibilityRefresh() {
      if (document.visibilityState === "visible") fetchData();
    }

    function handleFocusRefresh() {
      fetchData();
    }

    document.addEventListener("visibilitychange", handleVisibilityRefresh);
    window.addEventListener("focus", handleFocusRefresh);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
      window.removeEventListener("focus", handleFocusRefresh);
    };
  }, []);

  const plantMap = useMemo(() => {
    const map = {};
    plants.forEach((p) => {
      map[p.plant_id] = p;
    });
    return map;
  }, [plants]);

  const selectedLux = useMemo(
    () => ({ min: parseNumInput(luxMinInput), max: parseNumInput(luxMaxInput) }),
    [luxMinInput, luxMaxInput]
  );
  const selectedTemp = useMemo(
    () => ({ min: parseNumInput(tempMinInput), max: parseNumInput(tempMaxInput) }),
    [tempMinInput, tempMaxInput]
  );
  const selectedHumidity = useMemo(
    () => ({ min: parseNumInput(humidityMinInput), max: parseNumInput(humidityMaxInput) }),
    [humidityMinInput, humidityMaxInput]
  );
  const selectedAltitude = useMemo(
    () => ({ min: parseNumInput(altitudeMinInput), max: parseNumInput(altitudeMaxInput) }),
    [altitudeMinInput, altitudeMaxInput]
  );

  const filteredPlants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plants.filter((p) => {
      const qOk = !q || (p.search_blob || "").includes(q);

      const regionOk = regionMatches(p.region, selectedRegions);
      const monthOk = includesMonth(p, Number(selectedMonth || 0));
      const colorOk = !selectedColor || p.flower_color === selectedColor;
      const soilOk = !selectedSoil || p.soil === selectedSoil;
      const moistureOk = !selectedMoisture || p.moisture === selectedMoisture;
      const luxOk = rangeOverlaps(p.light_min_lux, p.light_max_lux, selectedLux.min, selectedLux.max);
      const tempOk = rangeOverlaps(p.temp_min_c, p.temp_max_c, selectedTemp.min, selectedTemp.max);
      const humidityOk = rangeOverlaps(
        p.humidity_min_percent,
        p.humidity_max_percent,
        selectedHumidity.min,
        selectedHumidity.max
      );
      const altitudeOk = rangeOverlaps(
        p.altitude_min_m,
        p.altitude_max_m,
        selectedAltitude.min,
        selectedAltitude.max
      );

      return (
        qOk &&
        regionOk &&
        monthOk &&
        colorOk &&
        soilOk &&
        moistureOk &&
        luxOk &&
        tempOk &&
        humidityOk &&
        altitudeOk
      );
    });
  }, [
    plants,
    search,
    selectedRegions,
    selectedMonth,
    selectedColor,
    selectedSoil,
    selectedMoisture,
    selectedLux,
    selectedTemp,
    selectedHumidity,
    selectedAltitude,
  ]);

  const filteredPhotos = useMemo(() => {
    return photos.filter((photo) => {
      const regionOk = regionMatches(photo.region, selectedPhotoRegions);
      const locationItems = String(photo.location_type || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const locationOk = !selectedPhotoLocation || locationItems.includes(selectedPhotoLocation);
      return regionOk && locationOk;
    });
  }, [photos, selectedPhotoRegions, selectedPhotoLocation]);

  const currentPhoto = useMemo(
    () => filteredPhotos.find((p) => p.photo_id === currentPhotoId) || filteredPhotos[0] || null,
    [filteredPhotos, currentPhotoId]
  );

  const filteredHotspots = useMemo(() => {
    const ids = new Set(filteredPlants.map((p) => p.plant_id));
    return (currentPhoto?.hotspots || []).filter((h) => ids.has(h.plantId));
  }, [currentPhoto, filteredPlants]);

  const featuredPlants = useMemo(() => {
    const hotIds = new Set((currentPhoto?.hotspots || []).map((h) => h.plantId));
    const inPhoto = filteredPlants.filter((p) => hotIds.has(p.plant_id));
    const outPhoto = filteredPlants.filter((p) => !hotIds.has(p.plant_id));
    return [...inPhoto, ...outPhoto];
  }, [filteredPlants, currentPhoto]);

  const plantPhotoMap = useMemo(() => {
    const map = {};
    photos.forEach((photo) => {
      (photo.hotspots || []).forEach((h) => {
        if (!map[h.plantId]) map[h.plantId] = [];
        map[h.plantId].push(photo);
      });
    });
    return map;
  }, [photos]);

  function toggleRegion(region) {
    setSelectedRegions((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
    );
  }

  function togglePhotoRegion(region) {
    setSelectedPhotoRegions((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
    );
  }

  function clearFilters() {
    setSearch("");
    setSelectedRegions([]);
    setSelectedPhotoRegions([]);
    setSelectedPhotoLocation("");
    setSelectedMonth("");
    setSelectedColor("");
    setSelectedSoil("");
    setSelectedMoisture("");
    setLuxMinInput("");
    setLuxMaxInput("");
    setTempMinInput("");
    setTempMaxInput("");
    setHumidityMinInput("");
    setHumidityMaxInput("");
    setAltitudeMinInput("");
    setAltitudeMaxInput("");
  }

  function openPlantExamplePhoto(photo) {
    setSelectedPhotoRegions([]);
    setSelectedPhotoLocation("");
    setCurrentPhotoId(photo.photo_id);
    setSelectedPlant(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }


  function openReferencePhoto(photoId) {
    setCurrentPhotoId(photoId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onStageClick(e) {
    if (!coordMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setCoordText(
      `x: ${x.toFixed(1)}\ny: ${y.toFixed(1)}\n\n貼り付け用:\n{ plantId: "ここにID", x: ${x.toFixed(1)}, y: ${y.toFixed(1)}, label: "植物名" }`
    );
  }

  const filterPanel = (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-600">植物名検索</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="和名・学名・科名で検索"
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-500"
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600">
          <MapPinned className="h-4 w-4" /> 分布
        </div>
        <div className="grid grid-cols-2 gap-2">
          {REGION_OPTIONS.map((region) => (
            <button
              key={region}
              type="button"
              onClick={() => toggleRegion(region)}
              className={`rounded-xl border px-3 py-2 text-sm transition ${
                selectedRegions.includes(region)
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {region}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-sm font-medium text-slate-600">植物の分布検索</div>
        <svg viewBox="0 0 100 100" className="w-full">
          {REGION_MAP_NODES.map((r) => {
            const active = selectedRegions.includes(r.id);
            return (
              <g key={r.id} onClick={() => toggleRegion(r.id)} className="cursor-pointer">
                <rect
                  x={r.x}
                  y={r.y}
                  rx="3"
                  ry="3"
                  width={r.w}
                  height={r.h}
                  fill={active ? "#047857" : "#e2e8f0"}
                  stroke={active ? "#065f46" : "#94a3b8"}
                />
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2 + 1}
                  textAnchor="middle"
                  fontSize="3.3"
                  fill={active ? "white" : "#334155"}
                >
                  {r.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600">
          <ImageIcon className="h-4 w-4" /> 実例写真の絞り込み
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {REGION_OPTIONS.map((region) => (
            <button
              key={`photo-${region}`}
              type="button"
              onClick={() => togglePhotoRegion(region)}
              className={`rounded-xl border px-3 py-2 text-sm transition ${
                selectedPhotoRegions.includes(region)
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {region}
            </button>
          ))}
        </div>
        <div className="mb-2 text-sm text-slate-500">撮影地タイプ</div>
        <select
          value={selectedPhotoLocation}
          onChange={(e) => setSelectedPhotoLocation(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
        >
          <option value="">指定なし</option>
          {PHOTO_LOCATION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
          <SlidersHorizontal className="h-4 w-4" /> 生育環境検索
        </div>
        <div className="mb-3 rounded-2xl bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
          最小値・最大値を直接入力して検索できます。空欄は未指定です。
        </div>

        <div className="space-y-3">
          <NumberRangeInput
            label="照度"
            minValue={luxMinInput}
            maxValue={luxMaxInput}
            setMinValue={setLuxMinInput}
            setMaxValue={setLuxMaxInput}
            minPlaceholder="例 2000"
            maxPlaceholder="例 8000"
            unit="lux"
          />
          <NumberRangeInput
            label="温度"
            minValue={tempMinInput}
            maxValue={tempMaxInput}
            setMinValue={setTempMinInput}
            setMaxValue={setTempMaxInput}
            minPlaceholder="例 -5"
            maxPlaceholder="例 20"
            unit="℃"
          />
          <NumberRangeInput
            label="湿度"
            minValue={humidityMinInput}
            maxValue={humidityMaxInput}
            setMinValue={setHumidityMinInput}
            setMaxValue={setHumidityMaxInput}
            minPlaceholder="例 60"
            maxPlaceholder="例 90"
            unit="%"
          />
          <NumberRangeInput
            label="標高"
            minValue={altitudeMinInput}
            maxValue={altitudeMaxInput}
            setMinValue={setAltitudeMinInput}
            setMaxValue={setAltitudeMaxInput}
            minPlaceholder="例 500"
            maxPlaceholder="例 1500"
            unit="m"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-600">開花月</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
          >
            <option value="">指定なし</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-600">花色</label>
          <select
            value={selectedColor}
            onChange={(e) => setSelectedColor(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
          >
            <option value="">指定なし</option>
            {FLOWER_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-600">土壌</label>
          <select
            value={selectedSoil}
            onChange={(e) => setSelectedSoil(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
          >
            <option value="">指定なし</option>
            {SOIL_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-600">湿度環境</label>
          <select
            value={selectedMoisture}
            onChange={(e) => setSelectedMoisture(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm"
          >
            <option value="">指定なし</option>
            {MOISTURE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setCoordMode((v) => !v)}
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-medium ${
            coordMode ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"
          }`}
        >
          座標確認 {coordMode ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
        >
          クリア
        </button>
      </div>

      <div className="whitespace-pre-wrap rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
        {coordText}
      </div>
    </div>
  );

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-6 text-slate-700">読み込み中...</div>;
  }

  if (error) {
    return <div className="min-h-screen bg-slate-50 p-6 text-red-700">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-[#f7f8f4] text-slate-800">
      <div className="mx-auto max-w-[1320px] px-3 pb-10 pt-3 md:px-6 md:pt-5">
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[32px] bg-white px-4 py-4 shadow-sm ring-1 ring-slate-200 md:px-5">
          <div>
            <div className="flex items-center gap-2 text-emerald-700">
              <Leaf className="h-5 w-5" />
              <span className="text-sm font-semibold">植物図鑑</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">写真・地図・条件から探す</h1>
            <p className="mt-1 text-sm text-slate-500">
              植物 {filteredPlants.length}件 / 実例写真 {filteredPhotos.length}件 / 写真内{" "}
              {filteredHotspots.length} hotspot
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Googleシート自動反映中 / 最終更新: {formatLastUpdated(lastUpdatedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="flex items-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-medium text-white md:hidden"
          >
            <Filter className="h-4 w-4" /> フィルター
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="hidden self-start rounded-[32px] bg-white p-4 shadow-sm ring-1 ring-slate-200 md:block md:sticky md:top-4">
            {filterPanel}
          </aside>

          <main className="space-y-4">
            <section className="rounded-[32px] bg-white p-3 shadow-sm ring-1 ring-slate-200 md:p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-xl font-bold md:text-2xl">
                    {currentPhoto?.title || "写真未選択"}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {currentPhoto?.subtitle || ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                  <ImageIcon className="h-4 w-4 text-slate-400" />
                  <select
                    value={currentPhotoId}
                    onChange={(e) => setCurrentPhotoId(e.target.value)}
                    className="max-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {filteredPhotos.map((p) => (
                      <option key={p.photo_id} value={p.photo_id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  地域: {currentPhoto?.region || "—"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  撮影地: {currentPhoto?.location_type || "—"}
                </span>
              </div>

              <div className="items-start grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div
                  className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-slate-100 shadow-inner"
                  onClick={onStageClick}
                >
                  <div className="relative aspect-[4/3] w-full">
                    {currentPhoto?.image_url ? (
                      <img
                        src={normalizeImageUrl(currentPhoto.image_url)}
                        alt={currentPhoto.title}
                        className="absolute inset-0 h-full w-full object-contain"
                        loading="lazy"
                        loading="lazy"
                        loading="lazy"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-400">
                        画像なし
                      </div>
                    )}

                    {filteredHotspots.map((h, idx) => {
                      const plant = plantMap[h.plantId];
                      if (!plant) return null;
                      return (
                        <div
                          key={`${h.plantId}-${idx}`}
                          className="group absolute"
                          style={{
                            left: `${h.x}%`,
                            top: `${h.y}%`,
                            transform: "translate(-50%, -50%)",
                          }}
                        >
                          <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100 group-active:opacity-100">
                            {h.label || plant.japanese_name}
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPlant(plant);
                            }}
                            className="relative h-11 w-11 rounded-full bg-transparent opacity-[0.02] focus:opacity-100 focus:outline-none active:opacity-100"
                            aria-label={h.label || plant.japanese_name}
                            title={h.label || plant.japanese_name}
                          >
                            <span className="absolute inset-0 rounded-full" />
                          </button>
                        </div>
                      );
                    })}

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent p-4 text-white">
                      <div className="text-sm font-medium">写真タップで植物を探す</div>
                      <div className="mt-1 text-xs text-white/85">
                        見えないホットスポットに触れると植物名が表示されます
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col rounded-[28px] bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-700">この写真の植物</div>
                      <div className="text-xs text-slate-500">{filteredHotspots.length} hotspot</div>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-slate-200">
                      写真連動
                    </span>
                  </div>
                  <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                    {filteredHotspots.length ? (
                      filteredHotspots.map((h, idx) => {
                        const plant = plantMap[h.plantId];
                        if (!plant) return null;
                        return (
                          <button
                            key={`${h.plantId}-side-${idx}`}
                            type="button"
                            onClick={() => setSelectedPlant(plant)}
                            className="flex w-full items-center justify-between rounded-2xl bg-white px-3 py-3 text-left ring-1 ring-slate-200 transition hover:ring-emerald-300"
                          >
                            <div>
                              <div className="text-sm font-semibold text-slate-800">
                                {plant.japanese_name}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500">
                                {plant.scientific_name}
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                        この写真に該当する植物はありません
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[32px] bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">参考写真一覧</h2>
                <div className="text-sm text-slate-500">{filteredPhotos.length}件</div>
              </div>

              {filteredPhotos.length ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {filteredPhotos.map((photo) => {
                    const isActive = photo.photo_id === currentPhotoId;
                    return (
                      <button
                        key={photo.photo_id}
                        type="button"
                        onClick={() => openReferencePhoto(photo.photo_id)}
                        className={`overflow-hidden rounded-[24px] border bg-white text-left transition ${
                          isActive
                            ? "border-emerald-500 ring-2 ring-emerald-200"
                            : "border-slate-200 hover:border-emerald-300"
                        }`}
                      >
                        <div className="relative aspect-[4/3] w-full bg-slate-100">
                          <img
                            src={normalizeImageUrl(photo.image_url)}
                            alt={photo.title}
                            className="absolute inset-0 h-full w-full object-contain"
                        loading="lazy"
                            loading="lazy"
                          />
                        </div>
                        <div className="p-3">
                          <div className="line-clamp-1 text-sm font-semibold text-slate-800">
                            {photo.title}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-slate-500">
                            {photo.subtitle || "説明なし"}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {photo.region ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                                {photo.region}
                              </span>
                            ) : null}
                            {photo.location_type ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                                {photo.location_type}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  条件に合う参考写真はありません
                </div>
              )}
            </section>

            <section className="rounded-[32px] bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">この実例で使われている植物</h2>
                <div className="text-sm text-slate-500">図鑑カード</div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {featuredPlants.map((p) => {
                  const inCurrentPhoto = (currentPhoto?.hotspots || []).some(
                    (h) => h.plantId === p.plant_id
                  );
                  return (
                    <button
                      key={p.plant_id}
                      type="button"
                      onClick={() => setSelectedPlant(p)}
                      className="rounded-[28px] border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:shadow md:p-5"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-bold leading-tight">{p.japanese_name}</div>
                          <div className="mt-1 text-sm italic text-slate-500">
                            {p.scientific_name}
                          </div>
                        </div>
                        {inCurrentPhoto && (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            写真内
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <Flower2 className="h-4 w-4" /> {p.flower_color || "—"}
                        </div>
                        <div className="flex items-center gap-2">
                          <Mountain className="h-4 w-4" />{" "}
                          {fmtRange(p.altitude_min_m, p.altitude_max_m, "m")}
                        </div>
                        <div className="flex items-center gap-2">
                          <SunMedium className="h-4 w-4" />{" "}
                          {fmtRange(p.light_min_lux, p.light_max_lux, "lux")}
                        </div>
                        <div className="flex items-center gap-2">
                          <Thermometer className="h-4 w-4" />{" "}
                          {fmtRange(p.temp_min_c, p.temp_max_c, "℃")}
                        </div>
                        <div className="flex items-center gap-2">
                          <Droplets className="h-4 w-4" />{" "}
                          {fmtRange(p.humidity_min_percent, p.humidity_max_percent, "%")}
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPinned className="h-4 w-4" /> {p.region || "—"}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
                        <span>
                          開花 {p.flower_start_month || "—"}〜{p.flower_end_month || "—"}月
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          詳細 / 実例写真 <ChevronRight className="h-4 w-4" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </main>
        </div>
      </div>

      {mobileFiltersOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileFiltersOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[88vh] overflow-auto rounded-t-[28px] bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-bold">検索条件</div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="rounded-full bg-slate-100 p-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {filterPanel}
          </div>
        </div>
      )}

      {selectedPlant && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={() => setSelectedPlant(null)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[92vh] overflow-auto rounded-t-[32px] bg-white p-5 shadow-2xl md:left-auto md:right-6 md:top-6 md:w-[520px] md:rounded-[32px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-2xl font-bold">{selectedPlant.japanese_name}</div>
                <div className="mt-1 text-sm italic text-slate-500">
                  {selectedPlant.scientific_name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlant(null)}
                className="rounded-full bg-slate-100 p-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedPlant.main_image_url ? (
              <div className="mb-4 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-100">
                <img
                  src={normalizeImageUrl(selectedPlant.main_image_url)}
                  alt={selectedPlant.japanese_name}
                  className="h-[240px] w-full object-contain"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="mb-4 flex h-[240px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
                植物単体写真なし
              </div>
            )}

            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {selectedPlant.family}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {selectedPlant.flower_color || "花色未設定"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {selectedPlant.plant_type || "分類未設定"}
              </span>
            </div>

            <div className="space-y-4 text-sm leading-7 text-slate-700">
              <section>
                <div className="mb-1 text-sm font-semibold text-slate-500">説明</div>
                <p>{selectedPlant.description || "—"}</p>
              </section>

              <section className="grid grid-cols-1 gap-3 rounded-3xl bg-slate-50 p-4 md:grid-cols-2">
                <Info label="分布" value={selectedPlant.region} icon={MapPinned} />
                <Info
                  label="開花"
                  value={`${selectedPlant.flower_start_month || "—"}〜${
                    selectedPlant.flower_end_month || "—"
                  }月`}
                  icon={Flower2}
                />
                <Info
                  label="照度"
                  value={fmtRange(selectedPlant.light_min_lux, selectedPlant.light_max_lux, "lux")}
                  icon={SunMedium}
                />
                <Info
                  label="温度"
                  value={fmtRange(selectedPlant.temp_min_c, selectedPlant.temp_max_c, "℃")}
                  icon={Thermometer}
                />
                <Info
                  label="湿度"
                  value={fmtRange(
                    selectedPlant.humidity_min_percent,
                    selectedPlant.humidity_max_percent,
                    "%"
                  )}
                  icon={Droplets}
                />
                <Info label="土壌" value={selectedPlant.soil || "—"} icon={Trees} />
              </section>

              <section className="grid grid-cols-1 gap-3 rounded-3xl border border-dashed border-slate-200 p-4 md:grid-cols-3">
                <Metric
                  label="実測照度"
                  value={
                    selectedPlant.measured_light_lux
                      ? `${selectedPlant.measured_light_lux} lux`
                      : "—"
                  }
                />
                <Metric
                  label="実測温度"
                  value={
                    selectedPlant.measured_temp_c != null
                      ? `${selectedPlant.measured_temp_c} ℃`
                      : "—"
                  }
                />
                <Metric
                  label="実測湿度"
                  value={
                    selectedPlant.measured_humidity_percent != null
                      ? `${selectedPlant.measured_humidity_percent} %`
                      : "—"
                  }
                />
              </section>

              <section>
                <div className="mb-1 text-sm font-semibold text-slate-500">メモ</div>
                <p>{selectedPlant.notes || "—"}</p>
              </section>

              <section>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-500">
                  <ImageIcon className="h-4 w-4" /> 使われている実例写真
                </div>
                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {(plantPhotoMap[selectedPlant.plant_id] || []).length ? (
                    plantPhotoMap[selectedPlant.plant_id].map((photo) => (
                      <button
                        key={`example-${photo.photo_id}`}
                        type="button"
                        onClick={() => openPlantExamplePhoto(photo)}
                        className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 text-left ring-1 ring-slate-200 transition hover:ring-emerald-300"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            {photo.title}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {photo.subtitle || "説明なし"}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                      この植物が使われている実例写真はまだありません
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
