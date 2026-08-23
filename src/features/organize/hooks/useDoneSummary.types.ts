export type UseDoneSummaryResult = {
  /** Distinct destination folders the run actually filed photos into, folder-name descending, capped at 3. */
  folders: string[];
  /**
   * The numeric `organize_jobs.id`s this run created — one per drive the
   * run organized, resolved the same way `folders` is (the newest
   * `organize_jobs` row per drive). Empty until resolved.
   */
  jobIds: number[];
  /** True while the real folders/job ids are still being resolved from `list_jobs`/`list_job_items`. */
  isLoading: boolean;
};
