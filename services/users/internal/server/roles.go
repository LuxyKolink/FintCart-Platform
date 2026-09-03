package server

import (
	"context"
	"errors"
	"fmt"
)

// Gestión de roles (FR-080). El cuarto rol, `administrador`, amplía los tres de
// FR-006 y es independiente de `coordinador_editorial` (FR-082).

// validRoles es el conjunto cerrado de roles que este servicio sabe asignar.
//
// Coincide con el CHECK de `roles_assignment` —que es la última barrera—, pero la
// validación ocurre aquí para que un rol desconocido salga como argumento inválido
// en la frontera y no como una violación de constraint a mitad de camino. Un mapa
// y no un `switch` para que el conjunto se pueda comparar en las pruebas sin
// invocar el método.
var validRoles = map[string]bool{
	RoleEndUser:              true,
	RoleEditor:               true,
	RoleEditorialCoordinator: true,
	RoleAdministrator:        true,
}

// AssignRole otorga `role` a la cuenta `userID` (FR-080).
//
// La autorización del ACTOR no se comprueba aquí: este RPC lo invoca el Gateway
// después de verificar en el borde que quien llama tiene rol administrador
// (FR-081, decisión D-21), y duplicar esa comprobación en el dominio haría que la
// garantía dependiera de que dos capas no se olviden de desincronizarse. Aquí solo
// se valida que la cuenta exista y que el rol sea del conjunto cerrado.
//
// Es idempotente: asignar un rol que la cuenta ya tiene es un no-op con éxito
// (el `ON CONFLICT DO NOTHING` de la persistencia), igual que el resto de
// escrituras de la saga (D-04).
func (s *Server) AssignRole(ctx context.Context, userID, role string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if !validRoles[role] {
		return fmt.Errorf("%w: %q no es un rol conocido", ErrInvalidArgument, role)
	}
	if err := s.store.AssignRole(ctx, id, role); err != nil {
		return fmt.Errorf("asignar rol %q: %w", role, err)
	}
	return nil
}

// RevokeRole retira `role` de la cuenta `userID` (FR-080).
//
// Revocar un rol que la cuenta no ostenta es un no-op con éxito: el estado final
// —sin ese rol— es el mismo, y tratar el caso como error obligaría a la interfaz a
// distinguir «ya lo había dejado de tener» de «no lo tenía desde antes», que no es
// una distinción que el cliente pueda usar. Que la cuenta NO exista sí es
// distinguible y sale como [ErrNotFound].
func (s *Server) RevokeRole(ctx context.Context, userID, role string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if !validRoles[role] {
		return fmt.Errorf("%w: %q no es un rol conocido", ErrInvalidArgument, role)
	}
	if err := s.store.RevokeRole(ctx, id, role); err != nil {
		return fmt.Errorf("revocar rol %q: %w", role, err)
	}
	return nil
}

// PromoteToAdministrator otorga el rol `administrador` a la cuenta cuyo correo
// llega por `BOOTSTRAP_ADMIN_EMAIL` (D-21, T026).
//
// El primer administrador NO se siembra en una migración: quedaría un usuario
// privilegiado escrito en el repositorio. Se aplica al arrancar, de forma
// idempotente —repetir el arranque con el mismo correo no re-promueve ni falla—.
//
// El correo puede no corresponder todavía a ninguna cuenta registrada (la
// promoción puede intentarse antes de que el registro llegue a su fin): en ese
// caso se devuelve [ErrNotFound] y el entrypoint decide —registrar y continuar—,
// de modo que el siguiente arranque consuma la promoción. El correo se normaliza
// antes de buscar, igual que en `CreateProfile`.
func (s *Server) PromoteToAdministrator(ctx context.Context, email string) error {
	addr, err := normalizeEmail(email)
	if err != nil {
		return err
	}
	id, err := s.store.ProfileIDByEmail(ctx, addr)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return ErrNotFound
		}
		return fmt.Errorf("buscar cuenta por correo: %w", err)
	}
	if err := s.store.AssignRole(ctx, id, RoleAdministrator); err != nil {
		return fmt.Errorf("promover a administrador: %w", err)
	}
	return nil
}
