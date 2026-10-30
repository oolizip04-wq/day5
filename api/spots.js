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

async function fetchAll(base, key) {
  const rows = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const u = new URL(base)
    u.searchParams.set('serviceKey', decodeKey(key))
    u.searchParams.set('page', page)
    u.searchParams.set('perPage', PER_PAGE)
    u.searchParams.set('returnType', 'JSON')
    const r = await fetch(u)
    if (!r.ok) throw new Error('upstream HTTP ' + r.status)
    const j = await r.json()
    const data = Array.isArray(j.data) ? j.data : []
    rows.push(...data)
    const total = Number(j.totalCount ?? j.matchCount ?? 0)
    if (!data.length || (total && rows.length >= total)) break
  }
  return rows
}

// 응답 컬럼명의 공백을 없애고 후보 이름 중 먼저 나오는 값을 사용
function pick(row, names) {
  const flat = {}
  for (const [k, v] of Object.entries(row)) flat[k.replace(/\s+/g, '')] = v
  for (const n of names) {
    const v = flat[n.replace(/\s+/g, '')]
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return ''
}

function merge(general, location) {
  const locById = new Map(location.map((l) => [pick(l, ['데이터고유번호']), l]))
  const items = []
  for (const g of general) {
    const id = pick(g, ['데이터고유번호'])
    const l = locById.get(id) || {}
    const lat = Number(pick(l, ['위도']) || pick(g, ['위도']))
    const lng = Number(pick(l, ['경도']) || pick(g, ['경도']))
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    items.push({
      id: Number(id),
      name: pick(g, ['장소명']) || pick(l, ['장소명']),
      lat, lng,
      zip: pick(l, ['우편번호']),
      address: pick(l, ['위치']),
      url: pick(l, ['데이터상세보기URL']),
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

module.exports = async function handler(req, res) {
  const env = process.env
  const missing = REQUIRED.filter((n) => !env[n])
  if (missing.length) {
    return res.status(500).json({ error: '서버 환경변수가 설정되지 않았습니다: ' + missing.join(', ') })
  }
  try {
    const [general, location] = await Promise.all([
      fetchAll(env.JEJU_CULTURE_INFO_URL, env.JEJU_CULTURE_INFO_KEY),
      fetchAll(env.JEJU_CULTURE_LOCATION_URL, env.JEJU_CULTURE_LOCATION_KEY),
    ])
    const items = merge(general, location)
    if (!items.length) return res.status(502).json({ error: 'API 응답에서 장소 데이터를 찾지 못했습니다(응답 형식 확인 필요).' })
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).json({ count: items.length, items })
  } catch (e) {
    // 키가 들어간 업스트림 주소는 응답에 싣지 않습니다.
    const msg = String(e.message || e).replace(/serviceKey=[^&\s]+/g, 'serviceKey=***')
    return res.status(502).json({ error: '공공데이터포털 호출 실패: ' + msg })
  }
}
