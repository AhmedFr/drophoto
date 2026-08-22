export type UseDoneSummaryResult = {
  /** Distinct destination folders the run actually filed photos into, folder-name descending, capped at 3. */
  folders: string[];
  /** True while the real folders are still being resolved from `list_job_items`. */
  isLoading: boolean;
};
