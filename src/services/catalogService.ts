import { getSupabaseClient } from '../lib/supabase';
import { describeSupabaseError } from './supabaseErrors';
import {
  Client,
  Cobrador,
  CobradorInput,
  Loan,
  Rubro,
  RubroInput,
  Zona,
  ZonaInput,
} from '../types/database';

const LOCAL_ZONAS_KEY = 'clientflow_demo_zonas';
const LOCAL_RUBROS_KEY = 'clientflow_demo_rubros';
const LOCAL_COBRADORES_KEY = 'clientflow_demo_cobradores';
const LOCAL_CLIENTS_KEY = 'clientflow_demo_clients';
const LOCAL_LOANS_KEY = 'clientflow_demo_loans';

// Catálogo inicial del Modo Demo: acompaña a los clientes de muestra de
// clientService, para que sus zonas y cobradores existan de entrada.
const INITIAL_ZONAS: Zona[] = ['Centro', 'Norte', 'Sur'].map((nombre, i) => ({
  id: `z000000${i}-0000-4000-8000-00000000000${i}`,
  nombre,
  activa: true,
  created_at: new Date().toISOString(),
}));

const INITIAL_COBRADORES: Cobrador[] = [
  { nombre: 'Juan Pérez', zona: 'Centro' },
  { nombre: 'María López', zona: 'Sur' },
].map((c, i) => ({
  id: `c000000${i}-0000-4000-8000-00000000000${i}`,
  nombre: c.nombre,
  zona: c.zona,
  activo: true,
  created_at: new Date().toISOString(),
}));

const INITIAL_RUBROS: Rubro[] = ['Kiosco', 'Verdulería', 'Albañilería', 'Peluquería'].map(
  (nombre, i) => ({
    id: `r000000${i}-0000-4000-8000-00000000000${i}`,
    nombre,
    activo: true,
    created_at: new Date().toISOString(),
  })
);

function getLocal<T>(key: string, defaultData: T): T {
  const data = localStorage.getItem(key);
  if (!data) {
    localStorage.setItem(key, JSON.stringify(defaultData));
    return defaultData;
  }
  try {
    return JSON.parse(data);
  } catch {
    return defaultData;
  }
}

function setLocal<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * En Modo Demo replicamos el ON UPDATE CASCADE / ON DELETE SET NULL que la base
 * aplica sobre `clients.zona`, `clients.cobrador` y `loans.cobrador`.
 */
function cascadeLocal(
  field: 'zona' | 'cobrador' | 'rubro',
  oldName: string,
  newName: string | null
): void {
  if (oldName === newName) return;

  const clients = getLocal<Client[]>(LOCAL_CLIENTS_KEY, []);
  setLocal(
    LOCAL_CLIENTS_KEY,
    clients.map(c => (c[field] === oldName ? { ...c, [field]: newName || undefined } : c))
  );

  if (field === 'cobrador') {
    const loans = getLocal<Loan[]>(LOCAL_LOANS_KEY, []);
    setLocal(
      LOCAL_LOANS_KEY,
      loans.map(l => (l.cobrador === oldName ? { ...l, cobrador: newName || undefined } : l))
    );
  }

  if (field === 'zona') {
    const cobradores = getLocal<Cobrador[]>(LOCAL_COBRADORES_KEY, INITIAL_COBRADORES);
    setLocal(
      LOCAL_COBRADORES_KEY,
      cobradores.map(c => (c.zona === oldName ? { ...c, zona: newName || undefined } : c))
    );
  }
}

export const catalogService = {
  // -------------------------------------------------------------------------
  // ZONAS
  // -------------------------------------------------------------------------

  async getZonas(): Promise<Zona[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('zonas')
        .select('*')
        .order('nombre', { ascending: true });
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar las zonas');
      return (data || []) as Zona[];
    }

    return getLocal<Zona[]>(LOCAL_ZONAS_KEY, INITIAL_ZONAS).sort((a, b) => a.nombre.localeCompare(b.nombre));
  },

  async createZona(input: ZonaInput): Promise<Zona> {
    const nombre = input.nombre.trim();
    if (!nombre) throw new Error('La zona necesita un nombre.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('zonas')
        .insert([{ ...input, nombre }])
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo crear la zona');
      return data as Zona;
    }

    const zonas = getLocal<Zona[]>(LOCAL_ZONAS_KEY, INITIAL_ZONAS);
    if (zonas.some(z => z.nombre.toLowerCase() === nombre.toLowerCase())) {
      throw new Error(`Ya existe una zona llamada "${nombre}".`);
    }

    const nueva: Zona = {
      id: crypto.randomUUID(),
      nombre,
      descripcion: input.descripcion,
      activa: input.activa ?? true,
      created_at: new Date().toISOString(),
    };
    setLocal(LOCAL_ZONAS_KEY, [...zonas, nueva]);
    return nueva;
  },

  async updateZona(zona: Zona, input: ZonaInput): Promise<Zona> {
    const nombre = (input.nombre ?? zona.nombre).trim();
    if (!nombre) throw new Error('La zona necesita un nombre.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('zonas')
        .update({ ...input, nombre })
        .eq('id', zona.id)
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo actualizar la zona');
      return data as Zona;
    }

    const zonas = getLocal<Zona[]>(LOCAL_ZONAS_KEY, INITIAL_ZONAS);
    const index = zonas.findIndex(z => z.id === zona.id);
    if (index === -1) throw new Error('No se encontró la zona.');

    const actualizada = { ...zonas[index], ...input, nombre };
    zonas[index] = actualizada;
    setLocal(LOCAL_ZONAS_KEY, zonas);
    cascadeLocal('zona', zona.nombre, nombre);
    return actualizada;
  },

  async deleteZona(zona: Zona): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('zonas').delete().eq('id', zona.id);
      if (error) throw describeSupabaseError(error, 'No se pudo eliminar la zona');
      return;
    }

    setLocal(
      LOCAL_ZONAS_KEY,
      getLocal<Zona[]>(LOCAL_ZONAS_KEY, INITIAL_ZONAS).filter(z => z.id !== zona.id)
    );
    cascadeLocal('zona', zona.nombre, null);
  },

  // -------------------------------------------------------------------------
  // COBRADORES
  // -------------------------------------------------------------------------

  async getCobradores(): Promise<Cobrador[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('cobradores')
        .select('*')
        .order('nombre', { ascending: true });
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar los cobradores');
      return (data || []) as Cobrador[];
    }

    return getLocal<Cobrador[]>(LOCAL_COBRADORES_KEY, INITIAL_COBRADORES).sort((a, b) =>
      a.nombre.localeCompare(b.nombre)
    );
  },

  async createCobrador(input: CobradorInput): Promise<Cobrador> {
    const nombre = input.nombre.trim();
    if (!nombre) throw new Error('El cobrador necesita un nombre.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('cobradores')
        .insert([{ ...input, nombre, telefono: input.telefono || null, zona: input.zona || null }])
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo crear el cobrador');
      return data as Cobrador;
    }

    const cobradores = getLocal<Cobrador[]>(LOCAL_COBRADORES_KEY, INITIAL_COBRADORES);
    if (cobradores.some(c => c.nombre.toLowerCase() === nombre.toLowerCase())) {
      throw new Error(`Ya existe un cobrador llamado "${nombre}".`);
    }

    const nuevo: Cobrador = {
      id: crypto.randomUUID(),
      nombre,
      telefono: input.telefono,
      zona: input.zona,
      activo: input.activo ?? true,
      created_at: new Date().toISOString(),
    };
    setLocal(LOCAL_COBRADORES_KEY, [...cobradores, nuevo]);
    return nuevo;
  },

  async updateCobrador(cobrador: Cobrador, input: CobradorInput): Promise<Cobrador> {
    const nombre = (input.nombre ?? cobrador.nombre).trim();
    if (!nombre) throw new Error('El cobrador necesita un nombre.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('cobradores')
        .update({ ...input, nombre, telefono: input.telefono || null, zona: input.zona || null })
        .eq('id', cobrador.id)
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo actualizar el cobrador');
      return data as Cobrador;
    }

    const cobradores = getLocal<Cobrador[]>(LOCAL_COBRADORES_KEY, INITIAL_COBRADORES);
    const index = cobradores.findIndex(c => c.id === cobrador.id);
    if (index === -1) throw new Error('No se encontró el cobrador.');

    const actualizado = { ...cobradores[index], ...input, nombre };
    cobradores[index] = actualizado;
    setLocal(LOCAL_COBRADORES_KEY, cobradores);
    cascadeLocal('cobrador', cobrador.nombre, nombre);
    return actualizado;
  },

  async deleteCobrador(cobrador: Cobrador): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('cobradores').delete().eq('id', cobrador.id);
      if (error) throw describeSupabaseError(error, 'No se pudo eliminar el cobrador');
      return;
    }

    setLocal(
      LOCAL_COBRADORES_KEY,
      getLocal<Cobrador[]>(LOCAL_COBRADORES_KEY, INITIAL_COBRADORES).filter(c => c.id !== cobrador.id)
    );
    cascadeLocal('cobrador', cobrador.nombre, null);
  },

  // -------------------------------------------------------------------------
  // RUBROS
  // -------------------------------------------------------------------------

  async getRubros(): Promise<Rubro[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('rubros')
        .select('*')
        .order('nombre', { ascending: true });
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar los rubros');
      return (data || []) as Rubro[];
    }

    return getLocal<Rubro[]>(LOCAL_RUBROS_KEY, INITIAL_RUBROS).sort((a, b) =>
      a.nombre.localeCompare(b.nombre)
    );
  },

  async createRubro(input: RubroInput): Promise<Rubro> {
    const nombre = input.nombre.trim();
    if (!nombre) throw new Error('El rubro necesita un nombre.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('rubros')
        .insert([{ ...input, nombre }])
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo crear el rubro');
      return data as Rubro;
    }

    const rubros = getLocal<Rubro[]>(LOCAL_RUBROS_KEY, INITIAL_RUBROS);
    if (rubros.some(r => r.nombre.toLowerCase() === nombre.toLowerCase())) {
      throw new Error(`Ya existe un rubro llamado "${nombre}".`);
    }

    const nuevo: Rubro = {
      id: crypto.randomUUID(),
      nombre,
      descripcion: input.descripcion,
      activo: input.activo ?? true,
      created_at: new Date().toISOString(),
    };
    setLocal(LOCAL_RUBROS_KEY, [...rubros, nuevo]);
    return nuevo;
  },

  async updateRubro(rubro: Rubro, input: RubroInput): Promise<Rubro> {
    const nombre = (input.nombre ?? rubro.nombre).trim();
    if (!nombre) throw new Error('El rubro necesita un nombre.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('rubros')
        .update({ ...input, nombre })
        .eq('id', rubro.id)
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo actualizar el rubro');
      return data as Rubro;
    }

    const rubros = getLocal<Rubro[]>(LOCAL_RUBROS_KEY, INITIAL_RUBROS);
    const index = rubros.findIndex(r => r.id === rubro.id);
    if (index === -1) throw new Error('No se encontró el rubro.');

    const actualizado = { ...rubros[index], ...input, nombre };
    rubros[index] = actualizado;
    setLocal(LOCAL_RUBROS_KEY, rubros);
    cascadeLocal('rubro', rubro.nombre, nombre);
    return actualizado;
  },

  async deleteRubro(rubro: Rubro): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('rubros').delete().eq('id', rubro.id);
      if (error) throw describeSupabaseError(error, 'No se pudo eliminar el rubro');
      return;
    }

    setLocal(
      LOCAL_RUBROS_KEY,
      getLocal<Rubro[]>(LOCAL_RUBROS_KEY, INITIAL_RUBROS).filter(r => r.id !== rubro.id)
    );
    cascadeLocal('rubro', rubro.nombre, null);
  },
};
