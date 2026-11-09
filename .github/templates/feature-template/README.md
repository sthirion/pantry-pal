# Feature Agent Template

This directory contains templates for the feature agent development process.

## Template Files

### `prd.md` - Product Requirements Document
- **Purpose**: Captures business requirements, user stories, and acceptance criteria
- **When to Use**: PHASE 0 (PRD_INTAKE) of feature agent process
- **Key Sections**: User story, problem statement, business value, acceptance criteria, success metrics

### `design.md` - Technical Design Document  
- **Purpose**: Defines technical architecture, implementation strategy, and design decisions
- **When to Use**: PHASE 1 (DESIGN_DOC) of feature agent process
- **Key Sections**: Architecture diagrams, technical specifications, API contracts, testing strategy

### `tasks.md` - Implementation Task Breakdown
- **Purpose**: Breaks down implementation into manageable, trackable tasks
- **When to Use**: PHASE 2 (TASK_BREAKDOWN) of feature agent process
- **Key Sections**: Task definitions, effort estimates, dependencies, implementation phases

### `context.md` - Feature Context and Dependencies
- **Purpose**: Captures feature context, dependencies, and knowledge assets
- **When to Use**: Created alongside other templates for comprehensive documentation
- **Key Sections**: Business context, technical context, dependencies, risk management

## Usage Instructions

### 1. Starting a New Feature

**Manual Process**:
1. Create feature directory: `.github/memorybank/features/<feature-name>/`
2. Copy template files to the new directory
3. Replace all template placeholders with feature-specific content
4. Follow feature agent workflow phases for implementation

**Feature Agent Process**:
```
/start feature mobile-testing
```
- Agent automatically creates directory structure
- Populates templates with initial feature information
- Guides through feature agent workflow phases

### 2. Template Placeholder Replacement

**Required Replacements**:
- `[Feature Name]` → Actual feature name (e.g., "Mobile Testing")
- `[Date]` → Current date (YYYY-MM-DD format)
- `[Project Name]` → Specific project (e.g., "E2E Testing")
- `[User type]` → Target user role (e.g., "developer", "end user")
- All other `[Placeholder Text]` → Feature-specific content

**Guidelines**:
- Maintain consistent terminology across all documents
- Follow project naming conventions and patterns
- Include specific, measurable criteria in acceptance criteria and success metrics
- Reference existing project documentation and patterns where applicable

### 3. Feature Agent Workflow Integration

**Phase Progression**:
1. **PHASE 0**: Complete `prd.md` with stakeholder input → `/approve prd`
2. **PHASE 1**: Develop `design.md` with technical approach → `/approve design` 
3. **PHASE 2**: Create detailed `tasks.md` breakdown → `/approve tasks`
4. **PHASE 3**: Begin implementation with `/implement <TASK_ID>`

**Documentation Standards**:
- Each phase builds on previous phase outputs
- Maintain traceability between PRD requirements and design decisions
- Ensure task breakdown covers all design specifications
- Update context documentation as implementation progresses

## Example: Mobile Testing Feature

A feature workspace lives under `.github/memorybank/features/<feature-name>/`.

**Directory Structure**:
```
.github/memorybank/features/mobile-testing/
├── prd.md           # User story, business case, acceptance criteria
├── design.md        # Technical architecture, implementation phases
├── tasks.md         # Detailed task breakdown with implementation tasks
└── context.md       # Business/technical context, dependencies, risks
```

## Best Practices

### Content Quality
- **Be Specific**: Use concrete, measurable criteria and outcomes
- **Be Comprehensive**: Cover all aspects of functionality, security, performance, accessibility
- **Be Traceable**: Link requirements → design → tasks → implementation
- **Be Maintainable**: Update documentation as implementation progresses

### Project Integration
- **Follow Patterns**: Use existing project conventions and architectural patterns
- **Reference Context**: Link to relevant existing documentation and decision records
- **Align Standards**: Ensure compliance with project coding standards and quality gates
- **Enable Handoff**: Create documentation that enables knowledge transfer and team collaboration

### Template Evolution
- Update templates based on lessons learned from feature implementations
- Add new sections or modify structure as project needs evolve
- Maintain consistency across all features using the same template version
- Document template changes and rationale for future reference