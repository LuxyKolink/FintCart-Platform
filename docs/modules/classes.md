# Class Diagram (Descriptive)

---

## What "extends" means in this diagram

In UML 2.5, the word **extends** in a plain text class diagram refers to **generalization** — what most object-oriented languages implement as `extends` (Java, Kotlin) or inheritance. It means: *the child class is a specialization of the parent, inherits all its attributes and operations, and can be used anywhere the parent is expected (Liskov substitution).*

So when the diagram says `TextBlock` extends `ContentBlock`, it means:

- `TextBlock` **is a** `ContentBlock`
- It inherits `order: Integer` automatically
- Any code that accepts a `ContentBlock` can receive a `TextBlock` without knowing the difference
- The relationship arrow in a drawn UML diagram would be a **hollow triangle arrowhead** pointing from child to parent

This is distinct from the other relationships used here — association (a reference between peers), composition (an owner that controls the lifecycle of its parts), and dependency (one class uses another transiently). "Extends" is the only one that implies an **is-a** relationship rather than a **has-a** or **uses-a** relationship.

---

## Diagrams separated by bounded context

---

### Bounded Context 1 — `[Calculation]`

---

#### Enumerations

**`CalculatorType`** — `AMORTIZATION`, `EFFECTIVE_RATE`, `CREDIT_COST`, `LEASE`, `MORTGAGE`, `SAVINGS_PROJECTION`, `GOAL_SAVINGS`, `RECURRING_DEPOSIT`, `CDT`, `WITHDRAWAL_PROJECTION`

**`InterestRateType`** — `NOMINAL`, `EFFECTIVE`

**`CompoundingFrequency`** — `DAILY`, `MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`

**`PaymentFrequency`** — `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `QUARTERLY`, `ANNUAL`

**`AmortizationSystem`** — `FRENCH`, `GERMAN`, `AMERICAN`, `BULLET`

**`ContributionType`** — `FIXED`, `VARIABLE`, `NONE`

**`WithdrawalStrategy`** — `FIXED_AMOUNT`, `FIXED_PERIOD`, `PERCENTAGE_OF_BALANCE`

**`PeriodUnit`** — `DAYS`, `MONTHS`, `YEARS`

**`InputUnit`** — `PERCENTAGE`, `CURRENCY_AMOUNT`, `INTEGER_COUNT`, `FREQUENCY`

**`Currency`** — `COP`, `USD`, `EUR`

**`FinancialDirection`** — `CREDIT`, `SAVINGS`

---

#### Value Objects

**`CalculationInput`** *(immutable)*

- `name: String`
- `value: BigDecimal`
- `unit: InputUnit`

**`CalculationRequest`** *(immutable)*

- `calculatorType: CalculatorType`
- `inputs: List<CalculationInput>`
- `currency: Currency`
- `locale: Locale`
- `direction: FinancialDirection`

**`CalculationBreakdownEntry`** *(abstract, immutable)*

- `period: Integer`
- `periodLabel: String`

**`CreditBreakdownEntry`** *(immutable)* — generalizes `CalculationBreakdownEntry`

- `payment: BigDecimal`
- `principalPortion: BigDecimal`
- `interestPortion: BigDecimal`
- `remainingBalance: BigDecimal`

**`SavingsBreakdownEntry`** *(immutable)* — generalizes `CalculationBreakdownEntry`

- `openingBalance: BigDecimal`
- `contribution: BigDecimal`
- `interestEarned: BigDecimal`
- `closingBalance: BigDecimal`
- `cumulativeInterest: BigDecimal`

**`CalculationResult`** *(immutable)*

- `formulaId: String`
- `calculatedAt: LocalDateTime`
- `summary: Map<String, BigDecimal>`
- `breakdown: List<CalculationBreakdownEntry>`

**`CalculationPeriod`** *(immutable)*

- `amount: Integer`
- `unit: PeriodUnit`

**`ValidationResult`** *(immutable)*

- `valid: Boolean`
- `violations: List<String>`

---

#### Domain Services

**`PeriodConverter`** *(domain service)*

- `toMonths(period: CalculationPeriod): Integer`

---

#### Calculator Hierarchy

**`FinancialCalculator`** *(abstract)*

- `calculate(request: CalculationRequest): CalculationResult`
- `validate(inputs: List<CalculationInput>): ValidationResult`

**`AmortizationCalculator`** — generalizes `FinancialCalculator`

**`MortgageCalculator`** — generalizes `FinancialCalculator`

- `amortization: AmortizationCalculator` *(composed)*

**`EffectiveRateConverter`** — generalizes `FinancialCalculator`

**`CreditCostCalculator`** — generalizes `FinancialCalculator`

**`LeaseCalculator`** — generalizes `FinancialCalculator`

**`SavingsProjectionCalculator`** — generalizes `FinancialCalculator`

**`RecurringDepositCalculator`** — generalizes `FinancialCalculator`

**`CDTCalculator`** — generalizes `FinancialCalculator`

**`GoalBasedSavingsCalculator`** — generalizes `FinancialCalculator`

**`WithdrawalProjectionCalculator`** — generalizes `FinancialCalculator`

---

#### Factory & Registry

**`CalculatorFactory`**

- `create(request: CalculationRequest): FinancialCalculator`

**`CalculatorRegistry`**

- `register(type: CalculatorType, calculator: FinancialCalculator): void`
- `resolve(type: CalculatorType): FinancialCalculator`

---

#### Strategy Interfaces

**`PaymentScheduleStrategy`** *(interface)*

- `buildSchedule(inputs: List<CalculationInput>, system: AmortizationSystem): List<CreditBreakdownEntry>`

**`RateConversionStrategy`** *(interface)*

- `convert(rate: BigDecimal, from: CompoundingFrequency, to: CompoundingFrequency, type: InterestRateType): BigDecimal`

**`FeeAggregationStrategy`** *(interface)*

- `aggregate(baseCost: BigDecimal, fees: List<CalculationInput>): BigDecimal`

**`CompoundInterestStrategy`** *(interface)*

- `buildSchedule(inputs: List<CalculationInput>, strategy: WithdrawalStrategy): List<SavingsBreakdownEntry>`

**`ContributionScheduleStrategy`** *(interface)*

- `buildSchedule(inputs: List<CalculationInput>, type: ContributionType): List<SavingsBreakdownEntry>`

**`WithdrawalScheduleStrategy`** *(interface)*

- `buildSchedule(inputs: List<CalculationInput>, strategy: WithdrawalStrategy): List<SavingsBreakdownEntry>`

---

#### Relationships

**Composition**

- `CalculationRequest` composes `CalculationInput` (1 to many)
- `CalculationResult` composes `CalculationBreakdownEntry` (1 to many)
- `MortgageCalculator` composes `AmortizationCalculator` (1 to 1)

**Aggregation**

- `CalculatorRegistry` aggregates `FinancialCalculator` (1 to many)

**Generalization**

- `CreditBreakdownEntry` generalizes `CalculationBreakdownEntry`
- `SavingsBreakdownEntry` generalizes `CalculationBreakdownEntry`
- `AmortizationCalculator` generalizes `FinancialCalculator`
- `MortgageCalculator` generalizes `FinancialCalculator`
- `EffectiveRateConverter` generalizes `FinancialCalculator`
- `CreditCostCalculator` generalizes `FinancialCalculator`
- `LeaseCalculator` generalizes `FinancialCalculator`
- `SavingsProjectionCalculator` generalizes `FinancialCalculator`
- `RecurringDepositCalculator` generalizes `FinancialCalculator`
- `CDTCalculator` generalizes `FinancialCalculator`
- `GoalBasedSavingsCalculator` generalizes `FinancialCalculator`
- `WithdrawalProjectionCalculator` generalizes `FinancialCalculator`

**Association**

- `AmortizationCalculator` associates `PaymentScheduleStrategy` (1 to 1)
- `EffectiveRateConverter` associates `RateConversionStrategy` (1 to 1)
- `CreditCostCalculator` associates `FeeAggregationStrategy` (1 to 1)
- `SavingsProjectionCalculator` associates `CompoundInterestStrategy` (1 to 1)
- `RecurringDepositCalculator` associates `ContributionScheduleStrategy` (1 to 1)
- `WithdrawalProjectionCalculator` associates `WithdrawalScheduleStrategy` (1 to 1)

**Dependency**

- `CalculatorFactory` depends on `FinancialCalculator` (instantiates)
- `FinancialCalculator` depends on `CalculationResult` (creates)
- `FinancialCalculator` depends on `ValidationResult` (creates)
- `PeriodConverter` depends on `CalculationPeriod` (processes)

---

---

### Bounded Context 2 — `[Publishing]`

---

#### Enumerations

**`PublicationStatus`** — `DRAFT`, `PUBLISHED`, `ARCHIVED`

**`Language`** — `PYTHON`, `JS`, `R`, `JULIA`

**`ExecutionStatus`** — `SUCCESS`, `ERROR`, `TIMEOUT`

**`CalculatorType`** *(replicated from `[Calculation]` — read-only copy for block configuration)*
— `AMORTIZATION`, `EFFECTIVE_RATE`, `CREDIT_COST`, `LEASE`, `MORTGAGE`, `SAVINGS_PROJECTION`, `GOAL_SAVINGS`, `RECURRING_DEPOSIT`, `CDT`, `WITHDRAWAL_PROJECTION`

---

#### Value Objects

**`CalculationInput`** *(immutable — replicated from `[Calculation]` for block defaults)*

- `name: String`
- `value: BigDecimal`
- `unit: InputUnit`

**`CalculationResult`** *(immutable — replicated from `[Calculation]` for session storage)*

- `formulaId: String`
- `calculatedAt: LocalDateTime`
- `summary: Map<String, BigDecimal>`
- `breakdown: List<Map<String, Object>>`

**`RenderedOutput`** *(immutable)*

- `html: String`
- `assets: List<AssetReference>`

**`AssetReference`** *(immutable)*

- `assetId: String`
- `altText: String`
- `mimeType: String`

**`CitationReference`** *(immutable)*

- `referenceKey: String`
- `sourceTitle: String`
- `authors: List<String>`
- `publishedYear: Integer`

---

#### Domain Classes

**`Publication`**

- `id: String`
- `title: String`
- `status: PublicationStatus`
- `authorId: String` *(integration ref → `[Identity]`)*
- `categoryIds: List<String>` *(integration ref → `[Taxonomy]`)*
- `tagIds: List<String>` *(integration ref → `[Taxonomy]`)*

**`Section`**

- `title: String`
- `order: Integer`

**`ContentBlock`** *(abstract)*

- `order: Integer`

**`TextBlock`** — generalizes `ContentBlock`

- `markdown: String`

**`InteractiveBlock`** — generalizes `ContentBlock`

- `calculatorType: CalculatorType`
- `defaultInputs: List<CalculationInput>`
- `buildRequest(overrides: List<CalculationInput>): CalculationRequest`

**`LearningObjective`**

- `description: String`
- `order: Integer`

**`LearningExercise`**

- `description: String`
- `targetField: String`
- `expectedValue: BigDecimal`
- `tolerance: BigDecimal`

**`Hint`**

- `content: String`
- `order: Integer`

---

#### Application Services

**`ContentRenderer`** *(application service)*

- `render(block: ContentBlock): RenderedOutput`

---

#### Session & Learning Classes

**`InteractiveSession`**

- `id: String`
- `publicationId: String` *(integration ref → Publication)*
- `startedAt: LocalDateTime`
- `inputOverrides: List<CalculationInput>`
- `results: List<CalculationResult>`
- `reset(): void`

**`LearningProgress`**

- `publicationId: String` *(integration ref → Publication)*
- `startedAt: LocalDateTime`
- `completedAt: LocalDateTime`
- `completedBlocks: Integer`
- `totalBlocks: Integer`

**`BlockInteraction`**

- `interactedAt: LocalDateTime`
- `inputs: List<CalculationInput>`
- `result: CalculationResult`
- `executionStatus: ExecutionStatus`

---

#### Relationships

**Composition**

- `Publication` composes `Section` (1 to many)
- `Publication` composes `LearningObjective` (1 to many)
- `Publication` composes `CitationReference` (1 to many)
- `Section` composes `ContentBlock` (1 to many)
- `InteractiveBlock` composes `CalculationInput` (1 to many)
- `InteractiveBlock` composes `LearningExercise` (1 to 0..1)
- `LearningExercise` composes `Hint` (1 to many)
- `InteractiveSession` composes `CalculationInput` (1 to many)
- `InteractiveSession` composes `CalculationResult` (1 to many)
- `LearningProgress` composes `BlockInteraction` (1 to many)
- `BlockInteraction` composes `CalculationResult` (1 to 1)

**Generalization**

- `TextBlock` generalizes `ContentBlock`
- `InteractiveBlock` generalizes `ContentBlock`

**Association**

- `BlockInteraction` associates `InteractiveBlock` (many to 1)

**Dependency**

- `InteractiveBlock` depends on `CalculationRequest` (creates)
- `ContentRenderer` depends on `ContentBlock` (processes)
- `ContentRenderer` depends on `RenderedOutput` (creates)

**Integration references (cross-context, resolved at runtime)**

- `Publication.authorId` → `[Identity]` User
- `Publication.categoryIds` → `[Taxonomy]` Category
- `Publication.tagIds` → `[Taxonomy]` Tag
- `InteractiveSession` dispatches `CalculationRequest` → `[Calculation]` via application service

---

---

### Bounded Context 3 — `[Identity]`

---

#### Enumerations

**`Role`** — `READER`, `AUTHOR`, `EDITOR`, `ADMIN`

**`ResourceType`** — `PUBLICATION`, `CATEGORY`, `GLOBAL`

---

#### Value Objects

**`RoleAssignment`** *(immutable)*

- `role: Role`
- `resourceType: ResourceType`
- `resourceId: String`
- `assignedAt: LocalDateTime`

---

#### Domain Classes

**`User`**

- `id: String`
- `username: String`
- `displayName: String`
- `email: String`
- `roleAssignments: List<RoleAssignment>`
- `hasRole(role: Role, resourceType: ResourceType, resourceId: String): Boolean`
- `assignRole(assignment: RoleAssignment): void`
- `revokeRole(role: Role, resourceType: ResourceType, resourceId: String): void`

---

#### Relationships

**Composition**

- `User` composes `RoleAssignment` (1 to many)

---

---

### Bounded Context 4 — `[Taxonomy]`

---

#### Domain Classes

**`Category`**

- `id: String`
- `name: String`

**`Tag`**

- `id: String`
- `name: String`

---

#### Relationships

- No internal relationships. `Category` and `Tag` are independent aggregate roots referenced by id from `[Publishing]`.

---

---

### Cross-Context Integration Contract Summary

This table is the authoritative record of how the four contexts communicate. Nothing outside this table should cross a context boundary.

| Source context | Source class / field | Target context | Target class | Resolution mechanism |
|---|---|---|---|---|
| `[Publishing]` | `Publication.authorId` | `[Identity]` | `User` | API call at read time |
| `[Publishing]` | `Publication.categoryIds` | `[Taxonomy]` | `Category` | API call at read time |
| `[Publishing]` | `Publication.tagIds` | `[Taxonomy]` | `Tag` | API call at read time |
| `[Publishing]` | `InteractiveSession` (dispatch) | `[Calculation]` | `CalculatorFactory` | Application service call |

---

One final note on terminology going forward: I replaced every instance of "extends" in the relationships sections with **generalizes**, which is the precise UML 2.5 term for the hollow-triangle inheritance relationship. "Extends" is an implementation-language word that leaked into the original diagram. Using "generalizes" keeps the diagram language-agnostic and unambiguous — it cannot be confused with the UML `«extend»` stereotype used in use case diagrams, which means something entirely different.
