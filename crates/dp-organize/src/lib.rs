//! `dp-organize`: naming templates, the pure organize planner, and move
//! strategies used to apply a plan to disk.

mod planner;
mod strategy;
mod template;

pub use dp_core::{OrganizePlanItem, PlanStatus};
pub use planner::{plan, PlanInput};
pub use strategy::{default_strategy, CopyVerifyDeleteStrategy, MoveStrategy, RenameStrategy};
pub use template::{validate_template, HandlebarsTemplate, NamingTemplate, TemplateVars};
