import { PostgrestError } from '@supabase/supabase-js';

/**
 * Traduce los errores más comunes de PostgREST/Postgres a un mensaje que el
 * usuario pueda accionar, en vez de mostrar códigos crudos.
 */
export function describeSupabaseError(error: PostgrestError | null, context: string): Error {
  if (!error) return new Error(`${context}: error desconocido.`);

  const detail = error.message || '';

  switch (error.code) {
    case '42P01':
      return new Error(
        `${context}: las tablas todavía no existen en Supabase. Ejecutá los scripts de supabase/migrations en el SQL Editor.`
      );
    case '23505':
      if (detail.includes('clients_numero_key')) {
        return new Error(`${context}: ya existe un cliente con ese N° de cliente.`);
      }
      if (detail.includes('nombre_key')) {
        return new Error(`${context}: ya existe uno con ese nombre en el catálogo.`);
      }
      return new Error(`${context}: ya existe un registro con ese valor, y no se puede repetir.`);
    case '23503':
      return new Error(
        `${context}: la zona, el cobrador o el rubro elegido no existe en Configuración (o fue eliminado).`
      );
    case 'P0001':
      // Excepciones de nuestras funciones (emitir/rendir): el mensaje ya es para el usuario
      return new Error(detail);
    case '23514':
      return new Error(`${context}: alguno de los valores no es válido para este campo. ${detail}`);
    case '42501':
      return new Error(
        `${context}: las políticas de seguridad (RLS) bloquearon la operación. Revisá las policies de la tabla.`
      );
    case 'PGRST301':
    case 'PGRST302':
      return new Error(`${context}: la sesión o la clave anónima no son válidas. Volvé a iniciar sesión.`);
    case 'PGRST205':
      return new Error(
        `${context}: Supabase no encuentra la tabla en su cache de esquema. Ejecutá las migraciones y recargá.`
      );
    default:
      return new Error(`${context}: ${detail || 'fallo la comunicación con Supabase.'}`);
  }
}
