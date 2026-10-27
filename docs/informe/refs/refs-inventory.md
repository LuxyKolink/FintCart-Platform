# Inventario canónico de referencias

Consolidación de las **tres** bibliografías divergentes del proyecto en **una** lista de
trabajos únicos. Fuente de verdad de metadatos para `docs/informe/refs/referencias.bib`.

Fecha de verificación de red: **2026-10-27** (todos los DOI y URL se probaron con `curl`).

## Fuentes minadas

| Abreviatura | Archivo | Entradas crudas |
|---|---|---|
| `ref.md` | `docs/anteproyecto/referencias.md` | 51 ítems numerados → **46 fuentes** (5 ítems no son fuentes: ver §Excluidos) |
| `mr.md` | `docs/anteproyecto/marco-referencial.md` | **6** citas autor-año en prosa |
| `pdf` | `docs/anteproyecto/Propuesta Proyecto FintCart.pdf`, pp. 25-26 | **11** entradas en formato APA de gestor |

Total de citas de origen: **63**. Trabajos únicos tras deduplicar: **49**.

## Política de verificación y de clasificación

1. **`verified`** — el DOI resuelve en Crossref (`https://doi.org/<doi>` → `302`) **o** la URL
   devuelve `2xx`/`3xx`. Para los DOI cuya página de destino bloquea clientes automatizados
   (`403` en el *landing* del editor) se considera verificado el identificador, no el HTML.
2. **`unreachable`** — el localizador no resuelve y no existe DOI alternativo. Entre paréntesis
   el código HTTP observado. Distinguir dos casos: `404` = enlace muerto; `403` = página viva
   que rechaza `curl` (bloqueo anti-bot de Medium, ResearchGate, Wiley, SAGE, T&F, Elsevier,
   GAO, UNDP, IEEE). **Ninguno de los `403` se ha borrado**: el autor decide en navegador.
3. **`incomplete`** — falta autor, año o localizador. Nunca se rellenó un campo por conjetura.
4. **`duplicate`** — la entrada aparecía en ≥2 archivos; se conservó **la versión más completa**
   y el conflicto se registra en §Conflictos. La columna `source file(s)` lista todos los
   archivos donde apareció.
5. **`academic?`** — `yes` = arbitrado o research paper institucional (banco central, working
   paper). `weak` = informe/estadística oficial o catálogo de patrones de autor: citable, no
   arbitrado. `no` = página de producto, blog de proveedor, Medium, repositorio de ejemplo:
   **nunca** al marco teórico.
6. **`target chapter`** — `marco-referencial` (teoría y contexto), `marco-tecnologico`
   (decisiones de tecnología), `metodologia` (diseño), `evaluacion` (métricas y benchmarks).

## Inventario

| cite key | authors | year | title | venue/publisher | DOI | URL | source file(s) | academic? | target chapter | status | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mancone2024youth | Mancone, S.; Tosti, B.; Corrado, S.; Spica, G.; Zanon, A.; Diotaiuti, P. | 2024 | Youth, money, and behavior: the impact of financial literacy programs | Frontiers in Education, 9 | 10.3389/feduc.2024.1397060 | https://doi.org/10.3389/feduc.2024.1397060 | ref.md, mr.md, pdf | yes | marco-referencial | verified | `mr.md` lo atribuye a "Fernandes y Lynch Jr"; Crossref y `pdf` dan Mancone et al. Se conserva la autoría verificada. |
| cannistra2024impact | Cannistrà, M.; De Beckker, K.; Agasisti, T.; Amagir, A.; Põder, K.; Vartiak, L.; De Witte, K. | 2024 | The impact of an online game-based financial education course: Multi-country experimental evidence | Journal of Comparative Economics, 52(4), 825-847 | 10.1016/j.jce.2024.08.001 | https://doi.org/10.1016/j.jce.2024.08.001 | ref.md, mr.md, pdf | yes | marco-referencial | verified | **Conflicto triple**: `ref.md` dice "Economics of Education Review"; `mr.md` atribuye a "Kaiser y Menkhoff". Crossref: JCE 52(4):825-847, Cannistrà et al. |
| lotter2024review | Lotter, M.; Okoro, C. | 2024 | A review of Financial Education Implementation in Higher Education | 10th International Conference on Higher Education Advances (HEAd'24), Universitat Politècnica de València | 10.4995/head24.2024.17290 | https://doi.org/10.4995/head24.2024.17290 | ref.md | yes | marco-referencial | verified | `ref.md` lo listaba como ResearchGate; es ponencia arbitrada con DOI. |
| mishra2024digital | Mishra, D.; Agarwal, N.; Sharahiley, S.; Kandpal, V. | 2024 | Digital Financial Literacy and Its Impact on Financial Decision-Making of Women: Evidence from India | Journal of Risk and Financial Management, 17(10), 468 | 10.3390/jrfm17100468 | https://doi.org/10.3390/jrfm17100468 | ref.md, mr.md, pdf | yes | marco-referencial | verified | `mr.md` lo atribuye a "Singh et al." — incorrecto. `ref.md` no daba autores; `pdf` sí. |
| alafeef2025digital | Al-Afeef, M. A.; Alsmadi, A. A. | 2025 | Digital empowerment: unraveling the impact of digital literacy on financial mastery | Discover Sustainability, 6(1) | 10.1007/s43621-025-01137-5 | https://doi.org/10.1007/s43621-025-01137-5 | ref.md, mr.md, pdf | yes | marco-referencial | verified | `pdf` fecha 22-04-2024 y cita "6(311)"; `mr.md` atribuye a "Ozili (2025)". Crossref: 2025, vol. 6, Al-Afeef y Alsmadi. |
| kovacs2024thematic | Kovács, L.; Terták, E. | 2024 | Thematic review of financial education and financial literacy in the digital age | Acta Oeconomica, 74(4), 483-506 | 10.1556/032.2024.00023 | https://doi.org/10.1556/032.2024.00023 | ref.md | yes | marco-referencial | verified | La URL de `ref.md` (`akjournals.com/.../article-p483.xml`) devuelve **404**; se sustituye por el DOI. |
| choung2023digital | Choung, Y.; Chatterjee, S.; Pak, T.-Y. | 2023 | Digital financial literacy and financial well-being | Finance Research Letters, 58, 104438 | 10.1016/j.frl.2023.104438 | https://doi.org/10.1016/j.frl.2023.104438 | ref.md | yes | marco-referencial | verified | `ref.md` solo daba "ScienceDirect (2023)" sin autores; datos completos vía Crossref (PII S1544612323008103 confirmado). |
| menberu2024technology | Menberu, A. W. | 2024 | Technology-mediated financial education in developing countries: a systematic literature review | Cogent Business & Management, 11(1) | 10.1080/23311975.2023.2294879 | https://doi.org/10.1080/23311975.2023.2294879 | ref.md | yes | marco-referencial | verified | `ref.md` decía "Cogent Economics & Finance" — la revista real es Cogent Business & Management. Landing del editor: 403. |
| koskelainen2023financial | Koskelainen, T.; Kalmi, P.; Scornavacca, E.; Vartiainen, T. | 2023 | Financial literacy in the digital age — A research agenda | Journal of Consumer Affairs, 57(1), 507-528 | 10.1111/joca.12510 | https://doi.org/10.1111/joca.12510 | ref.md | yes | marco-referencial | verified | `ref.md` no daba año ni autores. |
| gumilar2024digital | Gumilar, D. W. A.; Sangka, K. B.; Totalia, S. A. | 2024 | Digital Financial Literacy and Digital Financial Inclusion in the Era of Digital Disruption: Systematic Literature Review | Formosa Journal of Multidisciplinary Research, 3(5), 1563-1576 | 10.55927/fjmr.v3i5.9213 | https://doi.org/10.55927/fjmr.v3i5.9213 | ref.md | yes | marco-referencial | verified | `ref.md` sin autores ni año explícito. |
| lusardi2019financial | Lusardi, A. | 2019 | Financial literacy and the need for financial education: evidence and implications | Swiss Journal of Economics and Statistics, 155(1) | 10.1186/s41937-019-0027-5 | https://doi.org/10.1186/s41937-019-0027-5 | ref.md, mr.md, pdf | yes | marco-referencial | verified | `mr.md` cita "Lusardi y Mitchell (2019)"; la obra es de autor único (Lusardi). |
| amagir2017review | Amagir, A.; Groot, W.; Maassen van den Brink, H.; Wilschut, A. | 2017 | A review of financial-literacy education programs for children and adolescents | Citizenship, Social and Economics Education, 17(1), 56-80 | 10.1177/2047173417719555 | https://doi.org/10.1177/2047173417719555 | ref.md | yes | marco-referencial | verified | `ref.md` fecha 2018; Crossref: 2017 (online 07-2017), vol. 17(1). |
| dare2020effect | Dare, S. E.; van Dijk, W. W.; van Dijk, E.; van Dillen, L. F.; Gallucci, M.; Simonse, O. | 2020 | The effect of financial education on pupils' financial knowledge and skills: Evidence from a Solomon four-group design | The Journal of Educational Research, 113(2), 93-107 | 10.1080/00220671.2020.1733453 | https://doi.org/10.1080/00220671.2020.1733453 | ref.md | yes | metodologia | verified | Aporta el diseño Solomon four-group que justifica el diseño experimental del capítulo de metodología. |
| li2024design | Li, Q.; Zhang, L. | 2024 | Design and Implementation of Online Education Platform with Microservice Architecture | 2024 IEEE 15th International Conference on Software Engineering and Service Science (ICSESS), 173-177 | 10.1109/icsess62520.2024.10719050 | https://doi.org/10.1109/icsess62520.2024.10719050 | ref.md | yes | marco-tecnologico | verified | `ref.md` solo daba la URL de IEEE Xplore (documento 10719050). |
| ren2023design | Ren, X.; Wang, H.; Cai, T. | 2023 | Design and Implementation of a Microservices-Based Online Learning Platform | Proceedings of the 2023 2nd International Conference on Educational Innovation and Multimedia Technology (EIMT 2023), 455-460 | 10.2991/978-94-6463-192-0_60 | https://doi.org/10.2991/978-94-6463-192-0_60 | ref.md | yes | marco-tecnologico | verified | `ref.md` lo listaba como ResearchGate; es acta de Atlantis Press. |
| miao2020microservice | Miao, K.; Li, J.; Hong, W.; Chen, M. | 2020 | A Microservice-Based Big Data Analysis Platform for Online Educational Applications | Scientific Programming, 2020, 1-13 | 10.1155/2020/6929750 | https://doi.org/10.1155/2020/6929750 | ref.md | yes | marco-tecnologico | verified | — |
| dhandapani2025microservices | Dhandapani, A. | 2025 | Microservices Architecture in Financial Services: Enabling Real-Time Transaction Processing and Enhanced Scalability | European Journal of Computer Science and Information Technology, 13(32), 145-159 | 10.37745/ejcsit.2013/vol13n32145159 | https://doi.org/10.37745/ejcsit.2013/vol13n32145159 | ref.md | yes | evaluacion | verified | Se enruta a evaluación porque reporta throughput/latencia comparables con las corridas de k6; sirve además en marco-tecnologico. |
| lange2019microservices | Lange, M.; Koschel, A.; Hausotter, A. | 2019 | Microservices in Higher Education — Migrating a Legacy Insurance Core Application | Proceedings of the Microservices Conference 2019 (conf-micro.services) | — | https://www.conf-micro.services/2019/papers/Microservices_2019_paper_8.pdf | ref.md | yes | marco-tecnologico | verified | Autores y título leídos del PDF. Sin DOI, sin paginación ni volumen → esos campos se omiten. |
| richardsonndpattern | Richardson, C. | n.d. | Microservices Pattern: Microservice Architecture pattern | microservices.io | — | https://microservices.io/patterns/microservices.html | ref.md | weak | marco-tecnologico | verified | Catálogo de patrones de autor: citable, no arbitrado. `ref.md` lo atribuye a "Martin Fowler's site" — es de Chris Richardson. |
| banrep2024financial | Banco de la República | 2024 | Financial literacy and Financial Wellbeing: evidence from Colombia in a high inflation environment | Borradores de Economía (working paper), Banco de la República | — | https://www.banrep.gov.co/en/borradores-economia-financial-literacy-and-financial-wellbeing-evidence-colombia-high-inflation | ref.md, mr.md, pdf | yes | marco-referencial | incomplete | La página confirma publicación 2024-02-29 y el dato del 16.4 %, pero el campo "AUTHOR OR EDITOR" está vacío y no se pudo determinar la autoría individual ni el número de Borrador. |
| ustreasuryndfinancial | U.S. Department of the Treasury | n.d. | Financial Literacy and Education Commission | home.treasury.gov | — | https://home.treasury.gov/policy-issues/consumer-policy/financial-literacy-and-education-commission | ref.md | weak | marco-referencial | verified | `ref.md` fechaba "updated 2 weeks ago" → sin año determinable. |
| nefefoundationndnational | National Endowment for Financial Education | n.d. | National Endowment for Financial Education (NEFE) | nefe.org | — | https://www.nefe.org/ | ref.md | weak | marco-referencial | verified | Página institucional; el ítem de `ref.md` no da año. |
| nefefoundation2024grant | National Endowment for Financial Education | 2024 | NEFE Grant Program (cerca de US$410 000 en subvenciones) | nefe.org | — | — | ref.md | weak | marco-referencial | incomplete | `ref.md` no da URL ni ruta del programa: dato único (monto) pero no citable sin localizador. |
| finrafoundation2022financial | FINRA Investor Education Foundation | 2022 | Financial Education Matters: Testing the Effectiveness of Financial Education Across 76 Randomized Experiments | FINRA Foundation, *Insights: Financial Capability* (marzo 2022) | — | https://www.finrafoundation.org/sites/finrafoundation/files/Financial-Education-Matters-Testing-Effectiveness-Financial-Education_1.pdf | ref.md | weak | marco-referencial | verified | `ref.md` no daba año ni el título completo: ambos se leyeron del PDF (marzo 2022). |
| gao2025financial | U.S. Government Accountability Office | 2025 | Financial Literacy in the Digital Age (GAO-25-107168) | gao.gov | — | https://www.gao.gov/products/gao-25-107168 | ref.md | weak | marco-referencial | unreachable (403) | `gao.gov` rechaza clientes automatizados (403 incluso en `/assets/...pdf` con UA de navegador). Comprobar en navegador antes de citar. |
| koefer2024addressing | Koefer, F.; Bokkens, A.; Preziuso, M.; Ehrenhard, M. | 2024 | Addressing Financial and Digital Literacy Challenges for Inclusive Finance: Insights from Microfinance Institutions and FinTech Organisations | EIF Working Paper 2024/97, European Investment Fund | — | https://www.eif.org/news_centre/publications/eif_working_paper_2024_97.pdf | ref.md | weak | marco-referencial | verified | Autores y título leídos del PDF. `ref.md` no daba autoría. |
| occndfinancial | Office of the Comptroller of the Currency | 2024 | Financial Literacy Update (Q4 2024) | occ.gov | — | — | ref.md | weak | marco-referencial | incomplete | Boletín trimestral sin URL ni localizador en `ref.md`; no verificable. |
| wef2024financial | World Economic Forum | 2024 | Financial Literacy Statistics (reportes del WEF) | weforum.org | — | — | ref.md | weak | marco-referencial | incomplete | `ref.md` no da título de informe ni URL: no es citable tal cual. |
| nfec2025national | National Financial Educators Council | 2025 | Cost of Financial Illiteracy Study | financialeducatorscouncil.org | — | — | ref.md | weak | marco-referencial | incomplete | Sin URL ni título exacto del estudio. |
| inquiro2025filipino | Inquiro (research) | 2025 | Filipino Financial Literacy Study | — | — | — | ref.md | weak | marco-referencial | incomplete | Sin URL y con editor no identificable ("Inquiro research"); revisar si conviene descartar. |
| atlassian2024what | Atlassian | 2024 | What is Docker? Your Guide to Containerization | atlassian.com | — | https://www.atlassian.com/microservices/microservices-architecture/docker | pdf | no | marco-tecnologico | verified | Solo en el PDF. Página de producto. |
| encore2024go | Encore | 2024 | Go Microservices Frameworks in 2024 | encore.cloud | — | https://encore.cloud/resources/go-frameworks | pdf | no | marco-tecnologico | verified | Solo en el PDF. Blog de proveedor. |
| kodali2023nestjs | Kodali, S. | 2023 | NestJS microservices using gRPC as transporter | Medium | — | https://medium.com/@souravkodali/nestjs-microservices-using-grpc-as-transporter-cd3d90e54eb5 | pdf | no | marco-tecnologico | unreachable (403) | Solo en el PDF (Medium bloquea `curl`). Los demás campos provienen del PDF. |
| nestjsndgrpc | NestJS | n.d. | gRPC — Microservices (documentación oficial) | docs.nestjs.com | — | https://docs.nestjs.com/microservices/grpc | ref.md, pdf | no | marco-tecnologico | verified | Primer intento devolvió `000` (DNS transitorio); el reintento dio 200. Documentación oficial, no arbitrada. |
| etienam2023building | Etienam, I. | 2023 | Building a NestJS API Gateway with gRPC Microservice | Medium | — | https://medium.com/@ietienam/building-a-nestjs-api-gateway-with-grpc-microservice-35c900eba85e | ref.md, pdf | no | marco-tecnologico | unreachable (403) | Medium bloquea `curl`. `ref.md` decía "January 2024"; el PDF fecha 21-11-2023 → se conserva 2023. |
| creativetech2021using | (autor no identificado — publicación "Creative Technology Concepts & Code") | 2021 | Using gRPC with NestJS and Angular | Medium | — | https://medium.com/creative-technology-concepts-code/using-grpc-with-nestjs-and-angular-b60b444bc3ab | ref.md | no | marco-tecnologico | unreachable (403) | Autor no determinable: Medium bloquea la página (403) y `ref.md` no lo nombra. |
| semaphore2023microservices | Semaphore | 2023 | Microservices Communication in NestJS With gRPC | semaphore.io (blog de proveedor) | — | https://semaphore.io/blog/microservices-nestjs-grpc | ref.md | no | marco-tecnologico | verified | — |
| kmturleyndangular | kmturley | n.d. | angular-nest-grpc (repositorio de código) | GitHub | — | https://github.com/kmturley/angular-nest-grpc | ref.md | no | marco-tecnologico | verified | Repositorio de ejemplo: sin año. |
| adii2202ndfinancial | Adii2202 | n.d. | Financial-Literacy-Gamification (repositorio de código) | GitHub | — | https://github.com/Adii2202/Financial-Literacy-Gamification | ref.md | no | marco-tecnologico | verified | Repositorio de ejemplo: sin año ni publicación asociada. |
| starlingdiaz2025microservices | starlingdiaz70 | 2025 | Microservices Architecture in Financial Applications: Challenges and Solutions | Medium | — | https://medium.com/@starlingdiaz70/microservices-architecture-in-financial-applications-challenges-and-solutions-62589db1ad14 | ref.md | no | marco-tecnologico | unreachable (403) | Medium bloquea `curl`. |
| codesuite2025why | CodeSuite | 2025 | Why Microservices Architecture for Fintech Is the Future of Scalable Finance | codesuite.org (blog corporativo) | — | https://codesuite.org/blogs/why-microservices-architecture-for-fintech-is-the-future-of-scalable-finance/ | ref.md | no | marco-tecnologico | verified | — |
| velmie2023how | Velmie | 2023 | How to Build a Fintech Platform with Microservices Architecture | velmie.com (blog corporativo) | — | https://www.velmie.com/post/how-to-build-a-fintech-platform-with-microservices | ref.md | no | marco-tecnologico | verified | — |
| hqsoftware2023benefits | HQ Software | 2023 | 9 Benefits of Microservices Architecture for Banking | hqsoftwarelab.com (blog corporativo) | — | https://hqsoftwarelab.com/blog/banking-fintech-microservices-architecture-benefits/ | ref.md | no | marco-tecnologico | verified | — |
| smarticondrole | Smartico AI | n.d. | The Role Of Gamification In Financial Literacy | smartico.ai (blog corporativo) | — | https://www.smartico.ai/blog-post/gamification-in-financial-literacy | ref.md | no | marco-tecnologico | verified | Sin año en `ref.md`. |
| neuroprofiler2025gamification | Neuroprofiler | 2025 | Gamification and financial literacy, which applications to use? | neuroprofiler.com (blog corporativo) | — | https://neuroprofiler.com/en/gamification-and-financial-literacy-which-applications-to-use/ | ref.md | no | marco-tecnologico | verified | Primer intento `000`; el reintento dio 200. |
| undpndgamified | United Nations Development Programme | n.d. | Gamified Financial Education | undp.org | — | https://www.undp.org/latin-america/digitalhub4/projects/gamified-financial-education | ref.md | no | marco-tecnologico | unreachable (403) | Portal de proyecto (no arbitrado); `undp.org` rechaza `curl`. Sin año. |
| mogaland2023empowering | Mogaland | 2023 | Empowering Financial Freedom: How Gamified Learning Shapes Financial Education | Medium | — | https://medium.com/@Mogaland/empowering-financial-freedom-159f70266f94 | ref.md | no | marco-tecnologico | unreachable (403) | Medium bloquea `curl`. |
| straitsresearchndmicroservices | Straits Research | n.d. | Microservices Architecture Market Size, Share, Growth, Analysis, 2034 | straitsresearch.com | — | https://straitsresearch.com/report/microservices-architecture-market | ref.md | no | marco-tecnologico | verified | Estudio de mercado de proveedor; sin año en `ref.md`. |
| improvement2018existing | (autor no identificado) | 2018 | Improvement of an Existing Microservices Architecture for an E-learning Platform in STEM Education | ResearchGate | — | https://www.researchgate.net/publication/327018933_Improvement_of_an_Existing_Microservices_Architecture_for_an_E-learning_Platform_in_STEM_Education | ref.md | yes | marco-tecnologico | unreachable (403) | ResearchGate bloquea `curl` (403) y ni Crossref ni OpenAlex registran la obra: **autoría no determinada** y existencia no confirmada. Candidata a descarte. |

## Deduplicación

Cada fila es una aparición que se absorbió en la clave canónica (no genera entrada propia en el `.bib`).

| Obra | Archivo | clave canónica | Qué aportó el duplicado |
|---|---|---|---|
| Youth, money, and behavior | `mr.md`, `pdf` | mancone2024youth | Autoría completa (solo en `pdf`) |
| Online game-based financial education course | `mr.md`, `pdf` | cannistra2024impact | Revista, volumen, número y páginas (solo en `pdf`) |
| Digital Financial Literacy … Women: India | `mr.md`, `pdf` | mishra2024digital | Autoría completa (solo en `pdf`) |
| Digital empowerment | `mr.md`, `pdf` | alafeef2025digital | Autoría de Al-Afeef; DOI |
| Financial literacy and the need for financial education | `mr.md`, `pdf` | lusardi2019financial | DOI y fecha exacta |
| Financial literacy … evidence from Colombia | `mr.md`, `pdf` | banrep2024financial | Fecha de publicación (2024-02-29) |
| gRPC — Microservices (NestJS docs) | `pdf` | nestjsndgrpc | — (sin metadatos nuevos) |
| Building a NestJS API Gateway with gRPC | `pdf` | etienam2023building | Autoría, inicial y fecha (21-11-2023) |

Total: **14 apariciones duplicadas** (8 del PDF + 6 de `mr.md`), colapsadas en 8 claves canónicas.

## Conflictos de metadatos (registro explícito)

| Clave | Campo | `ref.md` | `mr.md` | `pdf` | Valor conservado (fuente) |
|---|---|---|---|---|---|
| cannistra2024impact | revista | Economics of Education Review | — | Journal of Comparative Economics, 52(4), 825-847 | Journal of Comparative Economics (Crossref) |
| cannistra2024impact | autoría | — | Kaiser y Menkhoff | Cannistrà et al. | Cannistrà et al. (Crossref) |
| mancone2024youth | autoría | — | Fernandes y Lynch Jr | Mancone et al. | Mancone et al. (Crossref) |
| mancone2024youth | volumen | — | — | — | 9 (Crossref) |
| mishra2024digital | autoría | — | Singh et al. | Mishra, Agarwal, Sharahiley, Kandpal | Mishra et al. (Crossref) |
| alafeef2025digital | año | 2025 | 2025 | 2024 | 2025 (Crossref) |
| alafeef2025digital | autoría | — | Ozili | Al-Afeef, M. A. | Al-Afeef y Alsmadi (Crossref) |
| alafeef2025digital | número | — | — | "6(311)" | 6(1) (Crossref); el "311" del PDF no es número de artículo |
| lusardi2019financial | autoría | Lusardi, A. | Lusardi y Mitchell | Lusardi, A. | Lusardi (autor único, Crossref) |
| amagir2017review | año | 2018 | — | — | 2017 (Crossref) |
| menberu2024technology | revista | Cogent Economics & Finance | — | — | Cogent Business & Management (Crossref) |
| etienam2023building | fecha | January 2024 | — | 21-11-2023 | 2023 (PDF) |
| richardsonndpattern | autoría | "Martin Fowler's site" | — | — | Chris Richardson (el propio sitio) |

## Bitácora de verificación (HTTP observado)

**DOI (17/17 resuelven `302` en Crossref).** `curl -sS -o /dev/null -w "%{http_code}" https://doi.org/<doi>`:

```
302  10.3389/feduc.2024.1397060        302  10.1111/joca.12510
302  10.1016/j.jce.2024.08.001         302  10.55927/fjmr.v3i5.9213
302  10.4995/head24.2024.17290         302  10.1186/s41937-019-0027-5
302  10.3390/jrfm17100468              302  10.1177/2047173417719555
302  10.1007/s43621-025-01137-5        302  10.1080/00220671.2020.1733453
302  10.1556/032.2024.00023            302  10.1109/icsess62520.2024.10719050
302  10.1016/j.frl.2023.104438         302  10.1155/2020/6929750
302  10.1080/23311975.2023.2294879     302  10.2991/978-94-6463-192-0_60
302  10.37745/ejcsit.2013/vol13n32145159
```

Con `-L` (siguiendo al editor), 6 de esos DOI terminan en `403` anti-bot
(`akjournals`, `tandfonline` ×2, `wiley` ×2, `sage`): el identificador es válido, el HTML no es
accesible desde la CLI.

**URL: `2xx` (25).** frontiersin 200 · link.springer 200 · formosapublisher 200 ·
sjes.springeropen 200 · banrep 200 · home.treasury 200 · nefe.org 200 · finrafoundation 200 ·
ieeexplore/document 202 · microservices.io 200 · conf-micro.services 200 · codesuite 200 ·
eajournals 200 · velmie 200 · hqsoftwarelab 200 · smartico 200 · semaphore 200 ·
github.com/kmturley 200 · github.com/Adii2202 200 · straitsresearch 200 · eif.org 200 ·
atlassian 200 · encore.cloud 200 · docs.nestjs.com 200 (reintento) · neuroprofiler 200 (reintento).

**URL: `403` (18).** sciencedirect ×2 · researchgate ×3 · mdpi · tandfonline ×2 ·
onlinelibrary.wiley ×2 · journals.sagepub · ieeexplore/document (primera pasada) — todas con DOI
válido → `verified` vía DOI. Sin DOI: medium ×5 · gao.gov · undp.org → `unreachable (403)`.

**URL: `404` (1).** `akjournals.com/view/journals/74/4/article-p483.xml` → enlace muerto;
sustituido por el DOI.

**URL: `000` (3, transitorios).** `docs.nestjs.com` y `neuroprofiler.com` → `200` en reintento;
`onlinelibrary.wiley.com/doi/10.1155/2020/6929750` → `403` en reintento (DOI válido).

Total de URL distintas probadas: 44 (25 × `2xx` + 18 × `403` + 1 × `404`).

## Recuento final

| Métrica | Valor |
|---|---|
| Citas de origen (3 archivos) | 63 |
| Ítems de `ref.md` que no son fuentes (excluidos) | 5 |
| Trabajos únicos | **49** |
| `verified` | **35** |
| `unreachable` | **8** (todos `403` anti-bot: 5 Medium, ResearchGate, GAO, UNDP; 0 enlaces muertos) |
| `incomplete` | **6** |
| Duplicados absorbidos | **14** |
| Académicos `yes` | 20 |
| Académicos `weak` | 11 |
| No académicos `no` | 18 |
| Aportación única de `ref.md` | 46 |
| Aportación única de `mr.md` | 0 (6 citas, 6 duplicadas; solo añade atribuciones erróneas) |
| Aportación única del `pdf` | 3 (atlassian2024what, encore2024go, kodali2023nestjs) |

## Excluidos (no son fuentes)

Ítems numerados de `ref.md` que no identifican una obra y por tanto no entran al inventario:
`#44` "Randomized Controlled Trials in Financial Education", `#45` "Systematic Literature
Review Approaches", `#46` "Assessment Metrics in Financial Education Research" (categorías de
método, sin obra ni localizador), `#50` "Research Paper Database Access" (lista de bases de
datos: IEEE Xplore, ScienceDirect, ResearchGate, SAGE, SpringerLink) y `#51` "Government and
Institutional Resources" (OECD, Superfinanciera, UN, Banco Mundial — sin documento concreto).

`#39`-`#43` **sí** se conservan porque citan un dato concreto, pero quedan `incomplete` al no
tener localizador; los cinco son candidatos naturales a descarte si el capítulo 1 se reescribe
con las fuentes del Banco de la República y el WEF que sí tienen URL.
