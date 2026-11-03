# Acceso a las fuentes: qué se pudo leer de verdad (medición 2026-11-03)

Registro de trabajo, no prosa de la tesis. Responde a una sola pregunta: **de las 46 entradas de
`refs/referencias.bib`, ¿de cuántas se ha tenido el texto completo en la mano?** No es una lista
de intenciones ni de disponibilidad editorial: cada veredicto se apoya en un fichero que se abrió
y se leyó ese día.

Los ficheros descargados viven (vivieron) en `/tmp/fuentes/`, un directorio temporal que se
pierde. Por eso este documento existe: los nombres de fichero, los tamaños y las páginas que
aparecen en la tabla son la prueba de lo leído, no rutas que vayan a seguir ahí. Lo que sobrevive
es el juicio, y el juicio es lo que `scripts/verify-citations.mjs` hace cumplir.

## Método

Orden de rutas, idéntico para las 46 claves, y **solo rutas legales** —sin pagos, sin espejos de
bibliotecas de sombras, sin cuentas, sin credenciales institucionales:

1. DOI/URL declarado en el `.bib`.
2. **Crossref** (metadatos y enlace de la editorial).
3. **OpenAlex** (`oa_url` de la obra).
4. **Unpaywall** (copia legal declarada).
5. Repositorio institucional legal (KU Leuven Lirias, Leiden, JYX, REAL, EconStor, la versión
   CC BY del propio editor, o una **captura Wayback de un PDF del propio editor**).
6. Ficha pública de la editorial, cuando las cinco anteriores no dan cuerpo.

Un PDF **solo cuenta como leído si `pdftotext` muestra el cuerpo** —método, resultados, conclusión,
referencias—, no la portada ni el abstract. Un HTML cuenta como completo solo si trae el artículo
entero, no su resumen.

**Lo que se encontró y NO se sorteó.** Tres sistemas anti-bot, ninguno eludido:

- **Cloudflare**: Springer, Wiley, SAGE, Elsevier, ISO, Taylor & Francis.
- **perfdrive**: Banrep (`banrep.gov.co`).
- **Anubis** (prueba de trabajo): EconStor.

Cuando existía una copia legal alternativa se usó la alternativa, no el rodeo: Kovacs por REAL,
Menberu por la versión CC BY del editor en T&F, Miao y Amagir por capturas Wayback de PDF del
propio editor. En EconStor y en Banrep no se sorteó nada y las claves afectadas quedan como
quedan.

**Sin buscador web.** `web_search` no estaba disponible (faltaban credenciales de Google CSE), así
que la localización de copias legales se hizo con **OpenAlex, Unpaywall y Semantic Scholar**, no
con un motor de búsqueda general. Es una limitación del método, no una propiedad de las fuentes:
es plausible que alguna de las 7 no-COMPLETO tenga copia legal que un buscador habría encontrado.

## Recuento

**39/46 COMPLETO** · **2 PARCIAL** · **4 SOLO-ABSTRACT** · **1 INACCESIBLE** · **0 SIN-LOCALIZADOR**

La separación que importa para la honestidad de la cita no es esa, sino la que cruza el veredicto
con el carácter de la fuente:

- De las **20** entradas marcadas `academic?=yes` en `refs-inventory.md`, **16 son COMPLETO**:
  mancone, cannistra, lotter, mishra, alafeef, kovacs, menberu, koskelainen, gumilar, lusardi,
  amagir, dare, ren, miao, dhandapani, lange. Las cuatro que no lo son —choung (INACCESIBLE), li,
  banrep, bangor (SOLO-ABSTRACT)— están todas en el marco referencial o en metodología, que es
  justo donde más duele.
- De las **18** marcadas `academic?=no`, **17 son COMPLETO** (solo `straitsresearch` es PARCIAL).
  Se leen enteras, pero son blogs de proveedor y READMEs: **valen como marco tecnológico, nunca
  como evidencia**. Un blog de proveedor leído entero sigue sin ser un dato.
- Las dos cifras suman 38 de 46. Las 8 restantes están marcadas `weak` en el inventario (informes
  institucionales y el catálogo de patrones de autor); de ellas 6 son COMPLETO, y las dos que no
  (`iso2018usability`, `brooke1996sus`) se explican más abajo.

## Tabla de las 46

Evidencia = fichero abierto y su extensión (páginas o palabras cuando el formato las da). «Qué
sostiene» está transcrito de lo leído en el texto descargado, no de la ficha del editor.

| clave | veredicto | evidencia (localizador · extensión) | qué sostiene (leído) |
|---|---|---|---|
| `mancone2024youth` | **COMPLETO** | `mancone2024youth.pdf` · 17 pp · 409 KB | Narrative review: effective youth financial education needs experiential learning, digital tools and parental involvement; calls for longitudinal designs. |
| `cannistra2024impact` | **COMPLETO** | `cannistra2024impact.pdf` · 23 pp · 675 KB | Multi-country RCT of a game-based ('Financial Escape Room') course: treatment students score significantly higher than controls. |
| `lotter2024review` | **COMPLETO** | `lotter2024review.pdf` · 8 pp · 258 KB | Review of financial education in higher education: programmes vary in length/format; maps outcomes and design features. |
| `mishra2024digital` | **COMPLETO** | `mishra2024digital.pdf` · 23 pp · 1.6 MB | PLS-SEM, women in India: digital financial literacy improves financial decision-making; government support mediates; FinTech adoption. |
| `alafeef2025digital` | **COMPLETO** | `alafeef2025digital.md` · 8 746 palabras (HTML OA completo) | PLS-SEM on 232 respondents: digital literacy drives financial behaviour, inclusion and well-being; all four hypotheses supported. |
| `kovacs2024thematic` | **COMPLETO** | `kovacs2024thematic.pdf` · 24 pp · 2.9 MB | Thematic review (CEE focus): digital-era products demand new competences, so financial education must be re-oriented, measured and taught differently. |
| `choung2023digital` | **INACCESIBLE** | ScienceDirect: HTTP 403 (Cloudflare) directo y vía lector; suscripción Elsevier (FRL 58:104438) | No body or abstract page reachable from this machine. |
| `menberu2024technology` | **COMPLETO** | `menberu2024technology.md` · 20 047 palabras (HTML OA completo) | SLR: technology-mediated financial education is scalable and cheap for developing countries but faces infrastructure, access, language and exclusion barriers. |
| `koskelainen2023financial` | **COMPLETO** | `koskelainen2023financial.pdf` · 17 pp · 1.35 MB | SLR + agenda: digitalisation reshapes financial literacy into three themes (digital finance use, capability, digital risks) and proposes a research agenda. |
| `gumilar2024digital` | **COMPLETO** | `gumilar2024digital.pdf` · 14 pp · 627 KB | SLR: digital financial literacy is a precondition for digital financial inclusion and for reducing economic inequality. |
| `lusardi2019financial` | **COMPLETO** | `lusardi2019financial.md` · 6 401 palabras (HTML OA completo) | 'Big Three' evidence: literacy is globally low (~30 %), harms saving, borrowing and planning; tailored school/workplace programmes are the way forward. |
| `amagir2017review` | **COMPLETO** | `amagir2017review.pdf` · 25 pp · 396 KB | Systematic review: school programmes improve knowledge and attitudes, but evidence on actual behaviour is scarce and hard to interpret. |
| `dare2020effect` | **COMPLETO** | `dare2020effect.pdf` · 16 pp · 1.64 MB | Solomon four-group quasi-experiment (N=2 650, Dutch grade 5): a national programme raised knowledge and skills versus controls. |
| `banrep2024financial` | **SOLO-ABSTRACT** | banrep.gov.co: 200 en el nodo print/pdf, pero el botón del PDF es solo JS, sin URL de fichero | Authors (Rodríguez-Pinilla, Castellanos-Rodríguez, López-Rodríguez, Esguerra Umaña) + full abstract read (16.4 % answer the Big Three); body not reachable. |
| `ustreasuryndfinancial` | **COMPLETO** | `ustreasuryndfinancial.txt` · 1 786 palabras | Institutional page: FLEC, its member agencies and its national-strategy role — descriptive only, no empirical claim. |
| `nefefoundationndnational` | **COMPLETO** | `nefefoundationndnational.txt` · 732 palabras | NEFE homepage: non-profit funding research and tools for financial well-being — framing only, no data. |
| `finrafoundation2022financial` | **COMPLETO** | `finrafoundation2022financial.pdf` · 9 pp · 402 KB | Meta-analysis of 76 randomised experiments: financial education has positive but modest mean effects, larger for knowledge than behaviour. |
| `gao2025financial` | **COMPLETO** | `gao2025financial.md` · texto del informe de 25 pp, 7 586 palabras | GAO forum: digital products widen access but add fraud and competency risk; consumers need technical *and* financial skill; more evaluation needed. |
| `koefer2024addressing` | **COMPLETO** | `koefer2024addressing.pdf` · 48 pp · 1.03 MB | Qualitative study of EU MFIs/FinTechs: institutions combine digital education, coaching and product design to reach financially and digitally illiterate customers. |
| `li2024design` | **SOLO-ABSTRACT** | ieeexplore: 202 (muro anti-bot); texto de la ficha de abstract, 941 palabras, leído por el lector | Only abstract of the ICSESS paper; PDF requires IEEE subscription. |
| `ren2023design` | **COMPLETO** | `ren2023design.pdf` · 6 pp · 751 KB | Design/implementation of a microservices-based online learning platform: module decomposition and the specific implementation techniques used. |
| `miao2020microservice` | **COMPLETO** | `miao2020microservice.pdf` · 13 pp · 6.8 MB | Architecture paper for 'Qunxian Platform': an educational big-data platform on microservices (JupyterHub + visual modelling) that shares data, compute and infrastructure. |
| `lange2019microservices` | **COMPLETO** | `lange2019microservices.pdf` · 4 pp · 337 KB | Teaching case: migrating a legacy insurance core application to microservices inside a bachelor-level higher-education course. |
| `dhandapani2025microservices` | **COMPLETO** | `dhandapani2025microservices.pdf` · 15 pp · 398 KB | Argumentative paper: moving banking/payment systems from monoliths to microservices gives real-time processing, scalability and resilience; domain-driven design as the basis. |
| `richardsonndpattern` | **COMPLETO** | `richardsonndpattern.txt` · 2 262 palabras | Pattern catalogue entry defining the microservice architecture pattern (services organised around business capability, independently deployable) and its trade-offs. |
| `atlassian2024what` | **COMPLETO** | `atlassian2024what.txt` · 1 871 palabras | Vendor explainer: containers bundle application plus dependencies for portable, reproducible deployment (Docker). |
| `encore2024go` | **COMPLETO** | `encore2024go.txt` · 1 767 palabras | Vendor comparison of Go microservice frameworks (redirige a encore.dev/articles/go-frameworks); opinion, not measurement. |
| `kodali2023nestjs` | **COMPLETO** | `kodali2023nestjs.md` · 952 palabras | Tutorial: NestJS microservices over the gRPC transporter — proto contracts and client/server wiring. |
| `nestjsndgrpc` | **COMPLETO** | `nestjsndgrpc.md` · 3 091 palabras | Official NestJS docs for gRPC: proto options, client injection, streaming and error handling. |
| `etienam2023building` | **COMPLETO** | `etienam2023building.md` · 3 957 palabras | Tutorial: building a NestJS API gateway in front of a gRPC microservice. |
| `creativetech2021using` | **COMPLETO** | `creativetech2021using.md` · 1 530 palabras | Tutorial: calling gRPC from Angular through a NestJS backend (proto sharing, web client). |
| `semaphore2023microservices` | **COMPLETO** | `semaphore2023microservices.txt` · 2 478 palabras | Vendor tutorial on NestJS inter-service communication with gRPC. |
| `kmturleyndangular` | **COMPLETO** | `kmturleyndangular.md` · 978 palabras (README) | Reference code repository: Angular + NestJS + gRPC example project — demonstrates wiring, no argument. |
| `adii2202ndfinancial` | **COMPLETO** | `adii2202ndfinancial.txt` · 1 152 palabras (README) | Reference code repository: gamified financial-literacy app (LLM/RAG stack) — demonstrates implementation, no argument. |
| `starlingdiaz2025microservices` | **COMPLETO** | `starlingdiaz2025microservices.md` · 4 464 palabras | Blog: restates microservices benefits for finance and lists challenges (consistency, observability, security) with generic mitigations. |
| `codesuite2025why` | **COMPLETO** | `codesuite2025why.txt` · 1 703 palabras | Vendor blog: microservices give fintech scalability, independent deployment and resilience. |
| `velmie2023how` | **COMPLETO** | `velmie2023how.txt` · 3 075 palabras (captura Wayback 2026-05-12; la URL viva ya redirige a la portada) | Vendor guide to building a fintech platform on microservices: domain decomposition, API layer, compliance-driven design. |
| `hqsoftware2023benefits` | **COMPLETO** | `hqsoftware2023benefits.txt` · 2 208 palabras | Vendor blog: nine benefits of microservices for banking (scalability, faster releases, fault isolation). |
| `smarticondrole` | **COMPLETO** | `smarticondrole.txt` · 1 314 palabras | Vendor blog: gamification mechanics raise engagement and retention in financial-literacy products. |
| `neuroprofiler2025gamification` | **COMPLETO** | `neuroprofiler2025gamification.txt` · 1 208 palabras | Vendor blog listing gamified financial-education applications and their pedagogical rationale. |
| `undpndgamified` | **COMPLETO** | `undpndgamified.md` · 1 361 palabras | UNDP project page: gamified financial education for Latin-American youth through the Digital4Development Hub — a project description, not an evaluation. |
| `mogaland2023empowering` | **COMPLETO** | `mogaland2023empowering.md` · 631 palabras | Vendor blog: gamified learning makes financial education engaging and improves retention. |
| `straitsresearchndmicroservices` | **PARCIAL** | página de aterrizaje del informe, 2 109 palabras leídas; el informe de mercado es un producto de pago | Only the public summary/marketing page is readable; figures behind it cannot be checked. |
| `brooke1996sus` | **PARCIAL** | página del capítulo en T&F: 200, 58 KB de HTML, 191 palabras de texto visible = solo la primera página | Opening page of ch. 35 (usability as fitness-for-purpose) visible; the SUS instrument itself, its scoring and 1996 pagination are behind the paywall — so the 189-194 vs 207-212 conflict cannot be settled from this text. |
| `bangor2008empirical` | **SOLO-ABSTRACT** | ficha de abstract en tandfonline (1 423 palabras con referencias); `/doi/pdf` devuelve 403 | Abstract + reference list only; body paywalled, no legal repository copy found. |
| `iso2018usability` | **SOLO-ABSTRACT** | iso.org: HTTP 403 (Cloudflare) incluso con cabeceras de navegador; ficha de catálogo + abstract/alcance leídos por la página de BSI (200) | Standard text is a paid ISO publication; only metadata, abstract and scope are readable. |

## Las 7 que no son COMPLETO, y por qué está cerrada cada una

No es una lista de pendientes: es el mapa de lo que **no** se puede afirmar. Cada una con su
motivo concreto, porque «no la tengo» no sirve para decidir qué se escribe.

- `choung2023digital` — **INACCESIBLE**. ScienceDirect responde 403 con Cloudflare al cliente y al
  lector; es suscripción Elsevier (*Finance Research Letters* 58:104438). No hay siquiera abstract
  alcanzable desde esta máquina. Único hueco real del marco referencial.
- `li2024design` (IEEE) — **SOLO-ABSTRACT**. IEEE Xplore devuelve 202 al cliente automático; el PDF
  exige suscripción. Se leyó el abstract del paper de ICSESS (941 palabras de ficha), nada más.
- `bangor2008empirical` (Taylor & Francis) — **SOLO-ABSTRACT**. Ficha de abstract con referencias
  (1 423 palabras) y `/doi/pdf` en 403; ninguna copia legal en repositorio.
- `banrep2024financial` (Banco de la República) — **SOLO-ABSTRACT**. La ficha responde 200 y da
  **autoría completa y abstract entero** (Rodríguez-Pinilla, Castellanos-Rodríguez,
  López-Rodríguez, Esguerra Umaña; 16,4 % acierta las Big Three), pero el PDF se sirve por un
  botón JS y no se encontró URL de fichero; `perfdrive` filtra el resto. Autoría y abstract son
  citables como ficha; el cuerpo no.
- `iso2018usability` (ISO) — **SOLO-ABSTRACT**. La norma es una publicación de pago. `iso.org` da
  403 con Cloudflare incluso con cabeceras de navegador; se leyó la ficha de catálogo y el
  alcance/abstract por la página de BSI (200). Se puede citar la existencia y el alcance de la
  norma, no su contenido cláusula por cláusula.
- `brooke1996sus` — **PARCIAL**. Página del capítulo en T&F: 200, 58 KB de HTML, **191 palabras
  visibles = la primera página**. Se ve el arranque del cap. 35 (la usabilidad como
  aptitud-para-el-propósito); el instrumento SUS, su puntuación y la paginación de 1996 están
  detrás del muro. **Consecuencia concreta: el conflicto de paginación 189-194 vs 207-212 sigue
  sin resolverse con el impreso.**
- `straitsresearchndmicroservices` — **PARCIAL**. Se lee la página pública de resumen (2 109
  palabras); el informe de mercado es un producto de pago, así que **las cifras que hay detrás no
  se pueden comprobar**.

## Regla que se deriva

**Una clave puede citarse por su existencia o por un hecho visible en la página que realmente se
leyó. No puede citarse por su argumento si su veredicto no es COMPLETO.**

Es la regla que se dio a quien redacta los capítulos, y no es un matiz retórico:

- `iso2018usability` citada en el capítulo 11 vale para «existe una norma de usabilidad que define
  el contexto de uso», no para lo que la norma exige en cada cláusula.
- `brooke1996sus` vale para «Brooke propuso el SUS en 1996», no para el instrumento, ni para su
  método de puntuación, ni para resolver la paginación.
- `banrep2024financial` vale para «el Banco de la República midió la alfabetización financiera en
  Colombia y reporta un 16,4 %», que está en el abstract, no para el diseño muestral ni las
  conclusiones del cuerpo.
- `li2024design`, `bangor2008empirical`, `choung2023digital` y `straitsresearchndmicroservices`:
  solo existencia (y, en los dos primeros, el abstract). **Ninguna afirmación del informe puede
  apoyarse en el argumento de estas obras.**

La medición se convirtió en puerta ejecutable en `docs/informe/scripts/verify-citations.mjs`: toda
clave citada en `chapters/*.tex` cuyo veredicto aquí no sea COMPLETO sale como WARN con el
veredicto a la vista. Así la regla no depende de que alguien la recuerde.
