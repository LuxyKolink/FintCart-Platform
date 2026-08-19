Labeled text field with hint, error, and prefix/suffix affixes — affixes are great for money fields.

```jsx
<Input label="Correo electrónico" type="email" placeholder="tu@correo.com" />
<Input label="Monto" prefix="$" suffix="COP" inputMode="numeric" />
<Input label="Contraseña" type="password" error="Mínimo 8 caracteres" />
```

Use `prefix="$"` for COP amounts and `suffix="%"` for rates in the simulators. Pass `error` to switch to the invalid state.
