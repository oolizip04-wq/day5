# 제주 역사문화 스탬프 투어

제주특별자치도 제주역사문화 일반정보·위치정보를 지도에 핀으로 보여 주고, 찜으로 답사 코스를 만들고, 방문 스탬프를 모으는 페이지입니다.

## 구성
- `index.html` — 화면 전체(지도, 검색, 찜 코스, 스탬프). CSV 데이터가 파일 안에 들어 있어 API가 안 되어도 동작합니다.
- `api/spots.js` — Vercel 서버리스 함수. 공공데이터포털 API를 서버에서 호출해 두 데이터를 합칩니다. 키는 브라우저로 나가지 않습니다.

## Vercel 환경변수 (이름만, 값은 Vercel 화면에서 입력)
| 이름 | 내용 |
|---|---|
| `JEJU_CULTURE_INFO_KEY` | 제주역사문화일반정보 인증키 |
| `JEJU_CULTURE_LOCATION_KEY` | 제주역사문화위치정보 인증키 |
| `JEJU_CULTURE_INFO_URL` | 일반정보 오픈API 요청 주소 (serviceKey 제외) |
| `JEJU_CULTURE_LOCATION_URL` | 위치정보 오픈API 요청 주소 (serviceKey 제외) |

로컬 테스트용 값은 `.env.local`에 쓰고 올리지 마세요. 이름 목록은 `.env.example`을 참고하세요.

데이터 출처: 제주특별자치도 제주역사문화 일반정보·위치정보 (기준일 2022-12-09)
