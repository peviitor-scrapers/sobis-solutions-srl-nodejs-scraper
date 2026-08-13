# Robots.txt Analysis — SOBIS SOLUTIONS S.R.L.

## Situație

SOBIS SOLUTIONS S.R.L. (CIF: 12018818) nu are o pagină publică de cariere. Scraperul folosește API-ul public ANOFM pentru a extrage job-urile companiei filtrate pe CIF.

Sursa datelor: [ANOFM](https://anofm.ro) — API public `/api/entity/vw_public_job_posting`

## Reguli

ANOFM este un site guvernamental (Agenția Națională pentru Ocuparea Forței de Muncă). API-ul public oferă job-uri gratis, filtrate pe CIF.

Nu există restricții de robots.txt pentru API-ul ANOFM — este un serviciu public guvernamental.

## Interpretare

| Cale | Accesibil? | Ce conține |
|---|---|---|
| `/api/entity/vw_public_job_posting` | ✅ Da (API public) | Job-uri filtrate pe CIF — sursa scraperului |
| Site-ul ANOFM principal | ✅ Da | Informații despre locuri de muncă |

## Recomandare

- API-ul ANOFM este public și nu necesită autentificare.
- Scraperul face o singură cerere GET pentru a fetcha job-urile companiei.
- Comportamentul este rezonabil — o singură cerere per rulare, fără paginare.

**Concluzie**: Risc minim. API-ul este public, guvernamental, fără restricții, o singură cerere per rulare.
