/** Stable codes of a `409` item mutation rejection. */
export type ItemMutationRejectionCode =
  | 'BASE_VERSION_EXPIRED'
  | 'BASE_VERSION_AHEAD'
  | 'MUTATION_ID_REUSED';

export type ApiErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'name_taken'
  | 'item_on_other_list'
  | ItemMutationRejectionCode
  | 'rate_limited'
  | 'internal_error';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
}
