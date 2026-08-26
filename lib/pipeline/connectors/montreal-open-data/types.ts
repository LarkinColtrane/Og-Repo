/**
 * The shape a CKAN portal returns.
 *
 * `donnees.montreal.ca` runs CKAN, the same open-source data portal behind
 * `open.canada.ca`, `donneesquebec.ca` and a few hundred municipal portals. That
 * is the reason this connector is worth writing carefully: the *transport* is a
 * documented, stable, widely-implemented standard, so this file will still be
 * correct against a portal nobody has thought of yet.
 *
 * What is **not** standard is the columns inside a dataset. CKAN says nothing
 * about whether a borough column is called `arrondissement` or
 * `nom_arrondissement`; that is a per-dataset fact, and it is handled explicitly
 * by the field contract in `datasets.ts` rather than assumed here.
 *
 * Nothing outside this directory should import these types. The normalizer turns
 * them into our own records, so a change at the publisher is a change to one
 * transform.
 *
 * @see https://docs.ckan.org/en/latest/maintaining/datastore.html
 */

/** Envelope every CKAN action endpoint returns. */
export interface CkanEnvelope<T> {
  help?: string;
  success: boolean;
  result?: T;
  error?: CkanError;
}

export interface CkanError {
  __type?: string;
  message?: string;
  [key: string]: unknown;
}

/** One column, as `datastore_search` describes it. */
export interface CkanField {
  id: string;
  /** CKAN/PostgreSQL type name: `text`, `numeric`, `int4`, `timestamp`… */
  type: string;
  info?: { label?: string; notes?: string };
}

/**
 * `datastore_search` result.
 *
 * A record's values are `unknown` on purpose. CKAN reflects whatever the
 * underlying table holds, so a numeric column can arrive as a number, a string,
 * or null depending on how the resource was uploaded. Typing them as `number`
 * here would be a lie the normalizer then has to unpick.
 */
export interface CkanDatastoreResult {
  resource_id: string;
  fields?: CkanField[];
  records?: Array<Record<string, unknown>>;
  /** Total rows matching the query, across all pages. */
  total?: number;
  limit?: number;
  offset?: number;
  _links?: { start?: string; next?: string };
}

/** `package_show` result — dataset metadata, used for provenance. */
export interface CkanPackageResult {
  id: string;
  name: string;
  title?: string;
  notes?: string;
  license_id?: string;
  license_title?: string;
  /** ISO timestamp of the last metadata change. */
  metadata_modified?: string;
  organization?: { title?: string; name?: string };
  resources?: CkanResource[];
}

export interface CkanResource {
  id: string;
  name?: string;
  format?: string;
  url?: string;
  /** True when the resource is queryable through `datastore_search`. */
  datastore_active?: boolean;
  last_modified?: string | null;
  created?: string;
}
