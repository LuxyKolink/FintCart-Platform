Primary action control — warm coral fill by default; use for the single most important action on a view.

```jsx
<Button variant="primary" size="md" onClick={save}>Guardar cambios</Button>
<Button variant="secondary">Cancelar</Button>
<Button variant="accent" iconRight={<Icon name="arrow-right" />}>Empezar a aprender</Button>
```

Variants: `primary` (coral CTA), `accent` (marigold), `secondary` (bordered white), `ghost` (link-like), `danger`. Sizes `sm | md | lg`. Use `block` to fill width, `iconLeft`/`iconRight` for Lucide icons. Only one primary per view.
