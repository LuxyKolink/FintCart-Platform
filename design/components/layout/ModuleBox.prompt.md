The signature FintCart portal container — every dense module (services list, topics, weather, ranking) is a ModuleBox. Bordered box with an accented header bar.

```jsx
<ModuleBox title="Temas de hoy" accent="var(--cat-inversion)" actions={<a href="#">Ver todo</a>}>
  <ul className="fc-linklist">…</ul>
</ModuleBox>
```

Set `accent` from the `--cat-*` or brand tokens to color the left rule. Use `padded={false}` when the body is an edge-to-edge list or table.
