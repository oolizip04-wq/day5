// Vercel 서버리스 함수: 공공데이터포털 API 키를 서버에서만 사용해 두 데이터를 합쳐 돌려줍니다.
// 환경변수 (Vercel 프로젝트 Settings > Environment Variables 에 등록, 로컬은 .env.local)
//   JEJU_CULTURE_INFO_KEY      제주역사문화일반정보 인증키
//   JEJU_CULTURE_LOCATION_KEY  제주역사문화위치정보 인증키
//   JEJU_CULTURE_INFO_URL      일반정보 요청 주소 (serviceKey 부분은 빼고 입력)
//   JEJU_CULTURE_LOCATION_URL  위치정보 요청 주소 (동일)

const MAX_PAGES = 10
const PER_PAGE = 100

// 키는 이미 %로 인코딩된 형태일 수 있으므로 한 번 풀어서 URLSearchParams가 다시 인코딩하게 합니다.
function decodeKey(k) {
  try { return k.includes('%') ? decodeURIComponent(k) : k } catch { return k }
}

// 응답에 키가 섞여 있을 가능성에 대비해 항상 가린 뒤 사용
function redact(s) {
  return String(s).replace(/(serviceKey|authKey|apikey)=[^&\s"'<]+/gi, '$1=***')
}

// 포털 응답 형태가 여러 가지라서(odcloud: data, 일반 OpenAPI: response.body.items.item 등) 행 배열을 찾아냄
function extractRows(j) {
  if (Array.isArray(j)) return j
  const cands = [j.data, j.items, j.records, j.response?.body?.items?.item, j.response?.body?.items, j.body?.items?.item, j.result?.items, j.result]
  for (const c of cands) {
    if (Array.isArray(c)) return c
    if (c && typeof c === 'object' && !Array.isArray(c) && Array.isArray(c.item)) return c.item
  }
  return []
}

function extractTotal(j) {
  return Number(j.totalCount ?? j.matchCount ?? j.response?.body?.totalCount ?? j.body?.totalCount ?? 0)
}

// 실패 원인을 알 수 있도록 포털이 준 메시지(있다면)를 뽑음
function extractMessage(j) {
  const m = j.response?.header?.resultMsg ?? j.header?.resultMsg ?? j.msg ?? j.message ?? j.resultMsg ?? j.error ?? j.result?.message
  return m ? redact(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 120) : ''
}

// 요청 주소로 API 설명서(Swagger/OpenAPI)를 넣은 경우, 설명서 안의 host·basePath·paths로 실제 데이터 주소를 만듦
function endpointFromSpec(j) {
  const paths = j && typeof j.paths === 'object' && j.paths ? j.paths : null
  if (!paths) return ''
  const p = Object.keys(paths).find((k) => paths[k] && paths[k].get)
  if (!p) return ''
  if (j.swagger && j.host) return (j.schemes && j.schemes.includes('https') ? 'https' : (j.schemes && j.schemes[0]) || 'https') + '://' + j.host + (j.basePath || '') + p
  if (j.openapi && Array.isArray(j.servers) && j.servers[0] && j.servers[0].url) return j.servers[0].url.replace(/\/$/, '') + p
  return ''
}

async function fetchAll(base, key, hop = 0) {
  const rows = []
  const diag = { rows: 0, columns: [], message: '', topKeys: [] }
  for (let page = 1; page <= MAX_PAGES; page++) {
    const u = new URL(base)
    u.searchParams.set('serviceKey', decodeKey(key))
    // 포털마다 쪽수 이름이 달라 두 방식 모두 전달 (모르는 파라미터는 무시됨)
    u.searchParams.set('page', page)
    u.searchParams.set('perPage', PER_PAGE)
    u.searchParams.set('pageNo', page)
    u.searchParams.set('numOfRows', PER_PAGE)
    u.searchParams.set('returnType', 'JSON')
    u.searchParams.set('dataType', 'JSON')
    const r = await fetch(u)
    const text = await r.text()
    if (!r.ok) {
      throw new Error('포털 응답 HTTP ' + r.status + (text ? ' - ' + redact(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120) : ''))
    }
    let j
    try { j = JSON.parse(text) } catch {
      // JSON이 아니면(XML 오류 문구 등) 그 문구를 보여줌
      throw new Error('포털 응답이 JSON이 아닙니다: ' + redact(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120))
    }
    if (page === 1) {
      // 설명서가 돌아왔으면 그 안의 실제 데이터 주소로 한 번만 다시 호출 (무한 반복 방지)
      const real = hop === 0 ? endpointFromSpec(j) : ''
      if (real && real !== base) return fetchAll(real, key, 1)
      diag.topKeys = Object.keys(j).slice(0, 8)
      diag.message = extractMessage(j)
    }
    const data = extractRows(j)
    rows.push(...data)
    const total = extractTotal(j)
    if (!data.length || (total && rows.length >= total)) break
  }
  diag.rows = rows.length
  if (rows[0] && typeof rows[0] === 'object') diag.columns = Object.keys(rows[0]).slice(0, 14).map((k) => k.slice(0, 20))
  return { rows, diag }
}

// 응답 컬럼명의 공백을 없애고 후보 이름 중 먼저 나오는 값을 사용
function pick(row, names) {
  const flat = {}
  for (const [k, v] of Object.entries(row)) flat[k.replace(/\s+/g, '').toLowerCase()] = v
  for (const n of names) {
    const v = flat[n.replace(/\s+/g, '').toLowerCase()]
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return ''
}

const ID = ['데이터고유번호', 'id', 'seq', 'no']
const NAME = ['장소명', 'name', 'title']
const LAT = ['위도', 'latitude', 'lat']
const LNG = ['경도', 'longitude', 'lng', 'lon']

function merge(general, location) {
  // 고유번호로 위치정보를 붙이고, 번호가 없으면 장소명으로 붙임
  const byId = new Map(), byName = new Map()
  for (const l of location) {
    const id = pick(l, ID), nm = pick(l, NAME)
    if (id) byId.set(id, l)
    if (nm) byName.set(nm, l)
  }
  const items = []
  for (const g of general) {
    const id = pick(g, ID)
    const nm = pick(g, NAME)
    const l = (id && byId.get(id)) || (nm && byName.get(nm)) || {}
    const lat = Number(pick(l, LAT) || pick(g, LAT))
    const lng = Number(pick(l, LNG) || pick(g, LNG))
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng) continue
    items.push({
      id: Number(id) || items.length + 1,
      name: nm || pick(l, NAME),
      lat, lng,
      zip: pick(l, ['우편번호', 'zipcode', 'zip']),
      address: pick(l, ['위치', 'address', 'addr']),
      url: pick(l, ['데이터상세보기URL', 'url']),
      cat: pick(g, ['분류']),
      dir1: pick(g, ['디렉토리1']),
      dir2: pick(g, ['디렉토리2']),
      title: pick(g, ['제목']),
      subtitle: pick(g, ['부제목']),
      author: pick(g, ['저작자']),
      topic: pick(g, ['주제']),
      content: pick(g, ['내용']),
      date: pick(g, ['발행일']),
      type: pick(g, ['자료유형']),
    })
  }
  return items
}

const REQUIRED = ['JEJU_CULTURE_INFO_KEY', 'JEJU_CULTURE_LOCATION_KEY', 'JEJU_CULTURE_INFO_URL', 'JEJU_CULTURE_LOCATION_URL']

function describe(label, d) {
  const cols = d.columns.length ? ' 컬럼: ' + d.columns.join(', ') : ''
  const msg = d.message ? ' 메시지: ' + d.message : ''
  const top = !d.rows && d.topKeys.length ? ' 응답 최상위 키: ' + d.topKeys.join(', ') : ''
  return label + ' ' + d.rows + '건.' + cols + msg + top
}

module.exports = async function handler(req, res) {
  const env = process.env
  const missing = REQUIRED.filter((n) => !env[n])
  if (missing.length) {
    return res.status(500).json({ error: '서버 환경변수가 설정되지 않았습니다: ' + missing.join(', ') })
  }
  try {
    const [g, l] = await Promise.all([
      fetchAll(env.JEJU_CULTURE_INFO_URL, env.JEJU_CULTURE_INFO_KEY),
      fetchAll(env.JEJU_CULTURE_LOCATION_URL, env.JEJU_CULTURE_LOCATION_KEY),
    ])
    const items = merge(g.rows, l.rows)
    if (!items.length) {
      // 키·값은 싣지 않고 건수와 컬럼 이름만 알려 응답 형식 차이를 바로 확인할 수 있게 함
      return res.status(502).json({ error: '장소 데이터를 합치지 못했습니다. ' + describe('일반정보', g.diag) + ' / ' + describe('위치정보', l.diag) })
    }
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).json({ count: items.length, items })
  } catch (e) {
    return res.status(502).json({ error: '공공데이터포털 호출 실패: ' + redact(e.message || e) })
  }
}
