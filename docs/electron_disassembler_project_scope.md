# Minimal IDA‑Like Disassembler Electron App --- Project Scope

## Overview

This project implements a **lightweight reverse‑engineering tool**
similar to a very stripped‑down version of IDA Pro.

The application will:

-   Load a Windows `.exe`
-   Disassemble machine code (not decompile)
-   Display disassembly per function
-   Visualize **control flow graphs (CFG)** of basic blocks
-   Show **cross references (xrefs)** between code and data

The goal is to produce a usable **interactive disassembler** with a
modern UI built with **Electron**, while keeping the analysis engine
relatively simple and focused.

------------------------------------------------------------------------

# Core User Experience

## Layout

    +-------------------------------------------------------------+
    | Functions / Imports / Strings | Disassembly View | Inspector|
    | (Navigation panel)            |                | Xrefs/Info |
    +-------------------------------------------------------------+
    |                    CFG Graph View (tab)                     |
    +-------------------------------------------------------------+

### Left Panel --- Navigation

Lists major program artifacts:

-   Functions
-   Imports
-   Exports
-   Strings (optional early feature)

Users can click an item to navigate directly to it.

------------------------------------------------------------------------

### Center Panel --- Disassembly View

Displays linear disassembly of a selected function.

Each row contains:

    Address | Bytes | Instruction | Operands

Features:

-   clickable jump targets
-   clickable call targets
-   clickable RIP-relative memory references
-   navigation history
-   "go to address" input

------------------------------------------------------------------------

### Right Panel --- Inspector

Contextual information about the selected item:

Function info:

-   address
-   size
-   section
-   calling convention guess (future)

Cross references:

-   xrefs to this function
-   xrefs from this function

------------------------------------------------------------------------

### Graph Tab --- Control Flow Graph

Visual representation of the function.

Nodes:

-   basic blocks
-   contain mini disassembly

Edges:

-   conditional branches
-   unconditional branches
-   fallthroughs

Graph library recommendation:

**Cytoscape.js**

Reasons:

-   fast
-   interactive
-   designed for graph visualization
-   works well inside Electron.

------------------------------------------------------------------------

# Architecture

Split responsibilities between **UI** and **analysis engine**.

## Electron UI (TypeScript)

Responsibilities:

-   file selection
-   navigation
-   graph visualization
-   displaying disassembly
-   IPC communication with analysis engine

Technologies:

-   Electron
-   React (optional but recommended)
-   Cytoscape.js for graphs

------------------------------------------------------------------------

## Analysis Engine (Rust)

Responsibilities:

-   PE parsing
-   disassembly
-   function discovery
-   basic block construction
-   CFG building
-   cross reference indexing

Reasons for Rust:

-   excellent binary analysis ecosystem
-   safe memory model
-   fast
-   easy to distribute as a single executable

Communication model:

    Electron UI
         |
         | IPC / stdio / HTTP
         v
    Rust Analysis Engine

------------------------------------------------------------------------

# Key Technical Components

## Disassembly Engine

### Option A --- iced-x86 (Recommended)

-   Highly accurate x86/x64 decoder
-   Available as WebAssembly/JS bindings
-   Excellent formatting support

Good fit when decoding instructions directly in UI or WASM.

------------------------------------------------------------------------

### Option B --- Capstone

Popular multi‑architecture disassembly engine.

Pros:

-   widely used
-   stable
-   multi‑architecture

Cons:

-   native bindings can complicate Electron builds

------------------------------------------------------------------------

## PE Parsing

### Option A --- LIEF

Supports:

-   PE
-   ELF
-   Mach-O

Advantages:

-   mature
-   feature rich
-   easy access to imports, exports, relocations.

------------------------------------------------------------------------

### Option B --- Rust crates

Examples:

-   goblin
-   object

Advantages:

-   lightweight
-   more control

------------------------------------------------------------------------

## Graph Rendering

Recommended:

Cytoscape.js

Alternative:

ELK (Eclipse Layout Kernel) later for improved hierarchical layouts.

------------------------------------------------------------------------

# MVP Scope

## MVP 1 --- Loader + Linear Disassembly

Goal:

Open an executable and disassemble starting at a known function.

### Tasks

1.  Load `.exe` file
2.  Parse PE headers
3.  Build RVA → file offset mapping
4.  Identify seed functions:

-   entry point
-   exports
-   import stubs

5.  Disassemble from a start address

Stop rules:

-   leaving section boundaries
-   invalid instruction streak
-   RET instruction

### UI

-   function list
-   disassembly table
-   "go to address" box

------------------------------------------------------------------------

## MVP 2 --- Basic Blocks + CFG

Goal:

Construct control flow graphs.

### Algorithm

Use recursive descent starting at function entry.

Split blocks at:

-   branch targets
-   fallthrough after conditional branch
-   RET
-   unconditional JMP

Calls do **not** end a block.

Maintain:

    visited_addresses

Add safety limits:

-   max instructions
-   max blocks

------------------------------------------------------------------------

## MVP 3 --- Cross References

Track relationships between instructions and addresses.

### Record:

-   direct CALL targets
-   direct JMP targets
-   conditional branch targets
-   RIP-relative memory references

### Store indexes

    code_xref[from] -> [to]
    code_xref_to[to] -> [from]

    data_xref[from] -> [addr]

### UI

Function inspector displays:

-   xrefs to
-   xrefs from

Clicking an xref navigates to the target.

------------------------------------------------------------------------

# Features That Make It Feel Like a Real RE Tool

## Function Discovery

Initial seeds:

-   entry point
-   exports

Later improvements:

-   recursive descent from entry
-   prologue scanning
-   x64 unwind metadata (.pdata)

------------------------------------------------------------------------

## Function Boundaries

Better methods:

1.  x64 `.pdata` unwind metadata
2.  reachability analysis
3.  stop at known function starts

------------------------------------------------------------------------

## Data Cross References

Improve by parsing:

-   `.rdata`
-   relocation tables
-   pointer tables
-   string references

------------------------------------------------------------------------

## Navigation Features

Quality-of-life features:

-   search for byte patterns
-   search for strings
-   jump to address
-   navigation history

------------------------------------------------------------------------

# Non‑Goals

To keep scope manageable, the following are intentionally excluded:

-   decompilation
-   SSA or IR lifting
-   type recovery
-   symbolic execution
-   emulation
-   packed binary analysis
-   kernel driver support

------------------------------------------------------------------------

# Security Considerations

Important when working with unknown binaries.

Never execute the loaded binary.

Recommended Electron settings:

    contextIsolation: true
    nodeIntegration: false
    sandbox: true

Perform all parsing and disassembly inside the **Rust analysis
process**, not the renderer.

------------------------------------------------------------------------

# Repository Structure

    /app-electron
        Electron UI
        React components
        graph rendering

    /engine
        Rust analysis service
        PE parsing
        disassembly
        CFG analysis

    /shared
        shared message types
        JSON schemas

    /docs
        architecture notes
        analysis algorithms

------------------------------------------------------------------------

# Engine API Example

    open(path) -> module_id

    getModuleInfo(module_id)

    listFunctions(module_id)
        -> [{start, name, kind}]

    analyzeFunction(module_id, start)
        -> {
            blocks,
            edges,
            instructions,
            xrefs
        }

    getXrefsTo(module_id, address)

------------------------------------------------------------------------

# Suggested Development Milestones

### Milestone 1

-   load PE
-   parse sections
-   disassemble instructions

### Milestone 2

-   build basic blocks
-   render CFG graph

### Milestone 3

-   build xref index
-   inspector panel

### Milestone 4

-   function discovery improvements
-   boundary detection

### Milestone 5

-   search tools
-   string analysis
-   bookmarks
-   UI polish

------------------------------------------------------------------------

# Final Goal

A fast, lightweight interactive disassembler that captures the **core
usability of IDA** while remaining small enough to build as a personal
project.
