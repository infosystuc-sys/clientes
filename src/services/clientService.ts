import { getSupabaseClient } from '../lib/supabase';
import { describeSupabaseError } from './supabaseErrors';
import { Client, ClientInput, Interaction } from '../types/database';

const LOCAL_CLIENTS_KEY = 'clientflow_demo_clients';
const LOCAL_INTERACTIONS_KEY = 'clientflow_demo_interactions';

// ---------------------------------------------------------------------------
// Datos de demostración para el Modo Local (sin Supabase configurado)
// ---------------------------------------------------------------------------

const INITIAL_CLIENTS: Client[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    numero: 1,
    name: 'Carlos Mendoza',
    company: 'TechSoluciones S.A.',
    email: 'carlos.mendoza@techsoluciones.com',
    phone: '1145218890',
    address: 'Av. Corrientes 1230, CABA',
    zona: 'Centro',
    cobrador: 'Juan Pérez',
    status: 'vip',
    rubro: 'Kiosco',
    total_spent: 14500.0,
    notes: 'Cliente prioritario para desarrollo a medida. Contrato anual.',
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    numero: 2,
    name: 'Mariana Gómez',
    company: 'Innovar Studio',
    email: 'm.gomez@innovarstudio.io',
    phone: '1132105544',
    address: 'Calle Florida 450, CABA',
    zona: 'Centro',
    cobrador: 'Juan Pérez',
    status: 'active',
    rubro: 'Verdulería',
    total_spent: 8200.0,
    notes: 'Interesada en renovación anual de servicios y consultoría de diseño.',
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    numero: 3,
    name: 'Roberto Fernández',
    company: 'Construcciones Norte',
    email: 'rfernandez@cnorte.com.ar',
    phone: '3519876543',
    address: 'Av. Colón 890, Córdoba',
    zona: 'Norte',
    cobrador: 'María López',
    status: 'lead',
    rubro: 'Albañilería',
    total_spent: 0.0,
    notes: 'Reunión inicial agendada para propuesta técnica de transformación digital.',
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    numero: 4,
    name: 'Elena Rossi',
    company: 'Rossi & Asociados',
    email: 'elena@rossiyasociados.com',
    phone: '3416543210',
    address: 'Bv. Oroño 230, Rosario',
    zona: 'Sur',
    cobrador: 'María López',
    status: 'active',
    rubro: 'Peluquería',
    total_spent: 3400.0,
    notes: 'Diseño de plataforma web en progreso.',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const INITIAL_INTERACTIONS: Interaction[] = [
  {
    id: 'c1111111-1111-1111-1111-111111111111',
    client_id: '11111111-1111-1111-1111-111111111111',
    type: 'meeting',
    summary: 'Reunión de avance de proyecto',
    details:
      'Se presentaron los prototipos del portal y la arquitectura Supabase. Cliente satisfecho.',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: 'c2222222-2222-2222-2222-222222222222',
    client_id: '22222222-2222-2222-2222-222222222222',
    type: 'email',
    summary: 'Envío de propuesta económica',
    details: 'Se envió la cotización detallada para la segunda fase del desarrollo.',
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Helpers de LocalStorage
// ---------------------------------------------------------------------------

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
 * Con Supabase configurado todas las operaciones van contra la base remota y los
 * errores se propagan para que la UI los muestre. El almacenamiento local es el
 * Modo Demo: se usa sólo si NO hay credenciales cargadas, nunca como respaldo
 * silencioso de una escritura remota fallida.
 */
export function isLiveMode(): boolean {
  return getSupabaseClient() !== null;
}

export const clientService = {
  isLiveMode,

  // -------------------------------------------------------------------------
  // CLIENTES
  // -------------------------------------------------------------------------

  async getClients(): Promise<Client[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar los clientes');
      return (data || []) as Client[];
    }
    return getLocal<Client[]>(LOCAL_CLIENTS_KEY, INITIAL_CLIENTS);
  },

  async createClient(clientData: ClientInput): Promise<Client> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('clients').insert([clientData]).select().single();
      if (error) throw describeSupabaseError(error, 'No se pudo crear el cliente');
      return data as Client;
    }

    // En modo local replicamos los valores por defecto y el trigger de número.
    const localClients = getLocal<Client[]>(LOCAL_CLIENTS_KEY, INITIAL_CLIENTS);
    if (clientData.numero && localClients.some(c => c.numero === clientData.numero)) {
      throw new Error(`Ya existe un cliente con el N° ${clientData.numero}.`);
    }
    const newClient: Client = {
      status: 'active',
      total_spent: 0,
      ...clientData,
      numero:
        clientData.numero || localClients.reduce((max, c) => Math.max(max, c.numero || 0), 0) + 1,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    setLocal(LOCAL_CLIENTS_KEY, [newClient, ...localClients]);
    return newClient;
  },

  async updateClient(id: string, clientData: Partial<Client>): Promise<Client> {
    const supabase = getSupabaseClient();

    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .update(clientData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo actualizar el cliente');
      return data as Client;
    }

    const localClients = getLocal<Client[]>(LOCAL_CLIENTS_KEY, INITIAL_CLIENTS);
    const index = localClients.findIndex(c => c.id === id);
    if (index === -1) throw new Error('No se encontró el cliente que querés actualizar.');
    if (clientData.numero && localClients.some(c => c.id !== id && c.numero === clientData.numero)) {
      throw new Error(`Ya existe un cliente con el N° ${clientData.numero}.`);
    }

    const updatedClient = {
      ...localClients[index],
      ...clientData,
      updated_at: new Date().toISOString(),
    };
    localClients[index] = updatedClient;
    setLocal(LOCAL_CLIENTS_KEY, localClients);
    return updatedClient;
  },

  async deleteClient(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw describeSupabaseError(error, 'No se pudo eliminar el cliente');
      return;
    }

    // En modo local replicamos el ON DELETE CASCADE de la base.
    const clients = getLocal<Client[]>(LOCAL_CLIENTS_KEY, INITIAL_CLIENTS);
    setLocal(
      LOCAL_CLIENTS_KEY,
      clients.filter(c => c.id !== id)
    );

    const interactions = getLocal<Interaction[]>(LOCAL_INTERACTIONS_KEY, INITIAL_INTERACTIONS);
    setLocal(
      LOCAL_INTERACTIONS_KEY,
      interactions.filter(i => i.client_id !== id)
    );
  },

  // -------------------------------------------------------------------------
  // INTERACCIONES (historial CRM)
  // -------------------------------------------------------------------------

  async getInteractions(clientId: string): Promise<Interaction[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('interactions')
        .select('*')
        .eq('client_id', clientId)
        .order('date', { ascending: false });
      if (error) {
        throw describeSupabaseError(error, 'No se pudo cargar el historial de interacciones');
      }
      return (data || []) as Interaction[];
    }

    const interactions = getLocal<Interaction[]>(LOCAL_INTERACTIONS_KEY, INITIAL_INTERACTIONS);
    return interactions.filter(i => i.client_id === clientId);
  },

  async createInteraction(
    interactionData: Omit<Interaction, 'id' | 'created_at'>
  ): Promise<Interaction> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('interactions')
        .insert([interactionData])
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo registrar la interacción');
      return data as Interaction;
    }

    const newInteraction: Interaction = {
      ...interactionData,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    const interactions = getLocal<Interaction[]>(LOCAL_INTERACTIONS_KEY, INITIAL_INTERACTIONS);
    setLocal(LOCAL_INTERACTIONS_KEY, [newInteraction, ...interactions]);
    return newInteraction;
  },

  async deleteInteraction(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('interactions').delete().eq('id', id);
      if (error) throw describeSupabaseError(error, 'No se pudo eliminar la interacción');
      return;
    }

    const interactions = getLocal<Interaction[]>(LOCAL_INTERACTIONS_KEY, INITIAL_INTERACTIONS);
    setLocal(
      LOCAL_INTERACTIONS_KEY,
      interactions.filter(i => i.id !== id)
    );
  },
};
