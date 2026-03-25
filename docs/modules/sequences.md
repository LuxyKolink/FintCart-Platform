# Important Sequences

---

## Identifying the most significant workflows

Your three servers map to the bounded contexts like this:

- **Authentication server** — owns `[Identity]`, handles login, token issuance, role validation
- **Application server** — owns `[Publishing]`, `[Taxonomy]`, orchestrates content delivery and session management
- **Orchestrator server** — owns `[Calculation]`, receives `CalculationRequest`, routes to the correct `FinancialCalculator`, returns `CalculationResult`

Given that architecture, these are the workflows that carry the most **architectural weight** — meaning they cross the most boundaries, involve the most failure points, or encode the most critical business rules:

---

### Workflow 1 — Authenticated publication access

**Why it is the most significant overall.** Every other workflow depends on this one succeeding first. It covers: token validation across the auth server, role resolution via `RoleAssignment`, publication retrieval with its cross-context references resolved (`authorId`, `categoryIds`, `tagIds`), and content block rendering. It touches all three servers and all four bounded contexts. If this workflow is wrong, nothing else works.

---

### Workflow 2 — Interactive calculation execution

**Why it matters.** This is the core value proposition of the system — a reader triggers an `InteractiveBlock`, the application server builds a `CalculationRequest`, the orchestrator resolves the correct `FinancialCalculator` via `CalculatorRegistry`, executes it, and returns a `CalculationResult` that gets stored in `BlockInteraction`. This is the only workflow where the orchestrator server does real computational work, and it is the most complex integration contract in the system.

---

### Workflow 3 — Publication lifecycle transition

**Why it matters.** An author or editor changes `PublicationStatus` from `DRAFT` to `PUBLISHED`. This requires authorization verification (`hasRole` on `[Identity]`), state transition validation, and has side effects on any active `InteractiveSession` or `LearningProgress` instances associated with that publication. It encodes the most critical business rules around who can do what to content.

---

Here are the three sequence diagrams in UML 2.5 plain text format, following OMG standards.

---

## Sequence Diagram 1 — Authenticated publication access

```txt
Title: Authenticated publication access

Actors / Participants:
  actor        Reader
  participant  ApplicationServer  as "Application Server"
  participant  AuthServer         as "Authentication Server"
  participant  OrchestratorServer as "Orchestrator Server  «unused in this flow»"
  participant  IdentityContext    as "[Identity]"
  participant  PublishingContext  as "[Publishing]"
  participant  TaxonomyContext    as "[Taxonomy]"

---

Reader -> ApplicationServer : GET /publications/{id}\n[Authorization: Bearer <token>]

activate ApplicationServer

  ApplicationServer -> AuthServer : validateToken(token)
  activate AuthServer
    AuthServer -> IdentityContext : findUserByTokenClaims(claims)
    activate IdentityContext
    IdentityContext --> AuthServer : User
    deactivate IdentityContext
    AuthServer -> IdentityContext : hasRole(userId, READER, PUBLICATION, publicationId)
    activate IdentityContext
    IdentityContext --> AuthServer : Boolean
    deactivate IdentityContext
  AuthServer --> ApplicationServer : TokenValidationResult {userId, roles}
  deactivate AuthServer

  alt token invalid or role denied
    ApplicationServer --> Reader : 401 Unauthorized / 403 Forbidden
  else token valid and role granted
    ApplicationServer -> PublishingContext : findPublication(publicationId)
    activate PublishingContext
    PublishingContext --> ApplicationServer : Publication
    deactivate PublishingContext

    alt publication status = ARCHIVED or DRAFT
      ApplicationServer --> Reader : 404 Not Found
    else publication status = PUBLISHED
      ApplicationServer -> TaxonomyContext : resolveCategories(categoryIds)
      activate TaxonomyContext
      TaxonomyContext --> ApplicationServer : List<Category>
      deactivate TaxonomyContext

      ApplicationServer -> TaxonomyContext : resolveTags(tagIds)
      activate TaxonomyContext
      TaxonomyContext --> ApplicationServer : List<Tag>
      deactivate TaxonomyContext

      ApplicationServer -> IdentityContext : resolveAuthor(authorId)
      activate IdentityContext
      IdentityContext --> ApplicationServer : User {displayName}
      deactivate IdentityContext

      ApplicationServer -> PublishingContext : renderContentBlocks(sections)
      activate PublishingContext
        loop for each ContentBlock in sections
          PublishingContext -> PublishingContext : ContentRenderer.render(block)
        end
      PublishingContext --> ApplicationServer : List<RenderedOutput>
      deactivate PublishingContext

      ApplicationServer --> Reader : 200 OK\nPublicationView {publication, author,\ncategories, tags, renderedBlocks}
    end
  end

deactivate ApplicationServer
```

---

## Sequence Diagram 2 — Interactive calculation execution

```txt
Title: Interactive calculation execution

Actors / Participants:
  actor        Reader
  participant  ApplicationServer  as "Application Server"
  participant  AuthServer         as "Authentication Server"
  participant  OrchestratorServer as "Orchestrator Server"
  participant  IdentityContext    as "[Identity]"
  participant  PublishingContext  as "[Publishing]"
  participant  CalcContext        as "[Calculation]"

---

Reader -> ApplicationServer : POST /sessions/{sessionId}/calculate\n[Authorization: Bearer <token>]\n[body: List<CalculationInput> overrides]

activate ApplicationServer

  ApplicationServer -> AuthServer : validateToken(token)
  activate AuthServer
    AuthServer -> IdentityContext : findUserByTokenClaims(claims)
    activate IdentityContext
    IdentityContext --> AuthServer : User
    deactivate IdentityContext
  AuthServer --> ApplicationServer : TokenValidationResult {userId}
  deactivate AuthServer

  alt token invalid
    ApplicationServer --> Reader : 401 Unauthorized
  else token valid
    ApplicationServer -> PublishingContext : findInteractiveSession(sessionId)
    activate PublishingContext
    PublishingContext --> ApplicationServer : InteractiveSession
    deactivate PublishingContext

    ApplicationServer -> PublishingContext : findInteractiveBlock(blockId)
    activate PublishingContext
    PublishingContext --> ApplicationServer : InteractiveBlock
    deactivate PublishingContext

    ApplicationServer -> PublishingContext : buildRequest(interactiveBlock, overrides)
    activate PublishingContext
      PublishingContext -> PublishingContext : InteractiveBlock.buildRequest(overrides)
    PublishingContext --> ApplicationServer : CalculationRequest
    deactivate PublishingContext

    ApplicationServer -> OrchestratorServer : POST /calculate\n[body: CalculationRequest]
    activate OrchestratorServer

      OrchestratorServer -> CalcContext : CalculatorFactory.create(request)
      activate CalcContext
        CalcContext -> CalcContext : CalculatorRegistry.resolve(calculatorType)
      CalcContext --> OrchestratorServer : FinancialCalculator
      deactivate CalcContext

      OrchestratorServer -> CalcContext : calculator.validate(inputs)
      activate CalcContext
      CalcContext --> OrchestratorServer : ValidationResult
      deactivate CalcContext

      alt validation failed
        OrchestratorServer --> ApplicationServer : 422 Unprocessable Entity\n{violations}
        ApplicationServer -> PublishingContext : recordBlockInteraction(ERROR, inputs, null)
        activate PublishingContext
        PublishingContext --> ApplicationServer : void
        deactivate PublishingContext
        ApplicationServer --> Reader : 422 Unprocessable Entity\n{violations}
      else validation passed
        OrchestratorServer -> CalcContext : calculator.calculate(request)
        activate CalcContext
          CalcContext -> CalcContext : strategy.buildSchedule(inputs)
        CalcContext --> OrchestratorServer : CalculationResult
        deactivate CalcContext
        OrchestratorServer --> ApplicationServer : 200 OK\nCalculationResult
      end

    deactivate OrchestratorServer

    alt calculation succeeded
      ApplicationServer -> PublishingContext : recordBlockInteraction(SUCCESS, inputs, result)
      activate PublishingContext
        PublishingContext -> PublishingContext : LearningProgress.updateCompletedBlocks()
      PublishingContext --> ApplicationServer : void
      deactivate PublishingContext
      ApplicationServer --> Reader : 200 OK\nCalculationResult {summary, breakdown}
    end

  end

deactivate ApplicationServer
```

---

## Sequence Diagram 3 — Publication lifecycle transition

```txt
Title: Publication lifecycle transition (DRAFT → PUBLISHED)

Actors / Participants:
  actor        Author
  participant  ApplicationServer as "Application Server"
  participant  AuthServer        as "Authentication Server"
  participant  IdentityContext   as "[Identity]"
  participant  PublishingContext as "[Publishing]"

---

Author -> ApplicationServer : PATCH /publications/{id}/status\n[Authorization: Bearer <token>]\n[body: {status: PUBLISHED}]

activate ApplicationServer

  ApplicationServer -> AuthServer : validateToken(token)
  activate AuthServer
    AuthServer -> IdentityContext : findUserByTokenClaims(claims)
    activate IdentityContext
    IdentityContext --> AuthServer : User
    deactivate IdentityContext
    AuthServer -> IdentityContext : hasRole(userId, AUTHOR, PUBLICATION, publicationId)
    activate IdentityContext
    IdentityContext --> AuthServer : Boolean
    deactivate IdentityContext
  AuthServer --> ApplicationServer : TokenValidationResult {userId, roles}
  deactivate AuthServer

  alt token invalid or role denied
    ApplicationServer --> Author : 401 Unauthorized / 403 Forbidden
  else token valid and role granted
    ApplicationServer -> PublishingContext : findPublication(publicationId)
    activate PublishingContext
    PublishingContext --> ApplicationServer : Publication {status: DRAFT}
    deactivate PublishingContext

    alt requested transition is illegal\n(e.g. ARCHIVED → PUBLISHED)
      ApplicationServer --> Author : 409 Conflict\n{message: invalid status transition}
    else transition is legal
      ApplicationServer -> PublishingContext : validatePublicationReadiness(publication)
      activate PublishingContext
        note over PublishingContext
          Checks: at least one Section exists,
          at least one LearningObjective exists,
          all InteractiveBlocks have valid
          defaultInputs resolvable by [Calculation]
        end note
      PublishingContext --> ApplicationServer : ValidationResult
      deactivate PublishingContext

      alt readiness validation failed
        ApplicationServer --> Author : 422 Unprocessable Entity\n{violations}
      else readiness validation passed
        ApplicationServer -> PublishingContext : transitionStatus(publicationId, PUBLISHED)
        activate PublishingContext
        PublishingContext --> ApplicationServer : Publication {status: PUBLISHED}
        deactivate PublishingContext

        ApplicationServer --> Author : 200 OK\nPublication {id, title, status: PUBLISHED}
      end
    end
  end

deactivate ApplicationServer
```

---

## Reading notes — UML 2.5 OMG conventions applied

A few conventions worth flagging so the team reads these correctly:

**`activate` / `deactivate`** represent the execution occurrence — the vertical bar on a lifeline in a drawn diagram. Every server or context that does work has an explicit activation scope so the diagram communicates not just what is called, but who holds control at each moment.

**`alt` fragments** are the UML 2.5 combined fragment for conditional branching. Each `else` branch is a separate operand. This is the correct replacement for informal "if/else" notation and maps directly to guard conditions in the OMG spec.

**`loop` fragments** (used in Diagram 1) represent iteration over a collection. In a drawn diagram this would be a box labeled `loop` wrapping the repeated messages.

**`note over`** attaches explanatory annotations to a lifeline without adding spurious messages. Used in Diagram 3 to document the readiness checks without inflating the message count.

**Cross-context calls** are shown as calls into a named context participant rather than directly to a class, which is consistent with the bounded context separation established in the class diagram. The context participant acts as the service boundary.

**Timeout and network failure paths** are intentionally omitted here to keep each diagram focused on the primary and most common alternative flows. A full production-grade version would add a `ref` fragment pointing to a dedicated error-handling sequence diagram.
