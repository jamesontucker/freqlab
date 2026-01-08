//! MIDI pattern presets for instrument plugins

/// A single note in a pattern
#[derive(Debug, Clone, Copy)]
pub struct PatternNote {
    /// When to play, in beats (0.0 = start of pattern)
    pub beat: f32,
    /// MIDI note number (0-127)
    pub note: u8,
    /// Velocity (0-127)
    pub velocity: u8,
    /// Duration in beats
    pub duration: f32,
}

impl PatternNote {
    pub const fn new(beat: f32, note: u8, velocity: u8, duration: f32) -> Self {
        Self { beat, note, velocity, duration }
    }
}

/// Pattern category
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PatternCategory {
    Melodic,
    Bass,
    Drums,
}

/// A MIDI pattern preset
#[derive(Debug, Clone)]
pub struct Pattern {
    /// Unique identifier
    pub id: &'static str,
    /// Display name
    pub name: &'static str,
    /// Category
    pub category: PatternCategory,
    /// Pattern length in beats
    pub length_beats: f32,
    /// Notes in the pattern
    pub notes: &'static [PatternNote],
}

/// Pattern info for frontend (without note data)
#[derive(Debug, Clone, serde::Serialize)]
pub struct PatternInfo {
    pub id: String,
    pub name: String,
    pub category: PatternCategory,
    pub length_beats: f32,
}

impl From<&Pattern> for PatternInfo {
    fn from(p: &Pattern) -> Self {
        Self {
            id: p.id.to_string(),
            name: p.name.to_string(),
            category: p.category,
            length_beats: p.length_beats,
        }
    }
}

// =============================================================================
// MELODIC PATTERNS
// =============================================================================

/// Arpeggio Up - C major triad ascending
const ARPEGGIO_UP_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 60, 100, 0.5),  // C4
    PatternNote::new(0.5, 64, 100, 0.5),  // E4
    PatternNote::new(1.0, 67, 100, 0.5),  // G4
    PatternNote::new(1.5, 72, 100, 0.5),  // C5
    PatternNote::new(2.0, 60, 100, 0.5),  // C4
    PatternNote::new(2.5, 64, 100, 0.5),  // E4
    PatternNote::new(3.0, 67, 100, 0.5),  // G4
    PatternNote::new(3.5, 72, 100, 0.5),  // C5
];

const ARPEGGIO_UP: Pattern = Pattern {
    id: "arpeggio_up",
    name: "Arpeggio Up",
    category: PatternCategory::Melodic,
    length_beats: 4.0,
    notes: ARPEGGIO_UP_NOTES,
};

/// Arpeggio Down - C major triad descending
const ARPEGGIO_DOWN_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 72, 100, 0.5),  // C5
    PatternNote::new(0.5, 67, 100, 0.5),  // G4
    PatternNote::new(1.0, 64, 100, 0.5),  // E4
    PatternNote::new(1.5, 60, 100, 0.5),  // C4
    PatternNote::new(2.0, 72, 100, 0.5),  // C5
    PatternNote::new(2.5, 67, 100, 0.5),  // G4
    PatternNote::new(3.0, 64, 100, 0.5),  // E4
    PatternNote::new(3.5, 60, 100, 0.5),  // C4
];

const ARPEGGIO_DOWN: Pattern = Pattern {
    id: "arpeggio_down",
    name: "Arpeggio Down",
    category: PatternCategory::Melodic,
    length_beats: 4.0,
    notes: ARPEGGIO_DOWN_NOTES,
};

/// Scale Run - C major scale ascending and descending
const SCALE_RUN_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 60, 100, 0.25),  // C4
    PatternNote::new(0.25, 62, 100, 0.25), // D4
    PatternNote::new(0.5, 64, 100, 0.25),  // E4
    PatternNote::new(0.75, 65, 100, 0.25), // F4
    PatternNote::new(1.0, 67, 100, 0.25),  // G4
    PatternNote::new(1.25, 69, 100, 0.25), // A4
    PatternNote::new(1.5, 71, 100, 0.25),  // B4
    PatternNote::new(1.75, 72, 100, 0.25), // C5
    PatternNote::new(2.0, 72, 100, 0.25),  // C5
    PatternNote::new(2.25, 71, 100, 0.25), // B4
    PatternNote::new(2.5, 69, 100, 0.25),  // A4
    PatternNote::new(2.75, 67, 100, 0.25), // G4
    PatternNote::new(3.0, 65, 100, 0.25),  // F4
    PatternNote::new(3.25, 64, 100, 0.25), // E4
    PatternNote::new(3.5, 62, 100, 0.25),  // D4
    PatternNote::new(3.75, 60, 100, 0.25), // C4
];

const SCALE_RUN: Pattern = Pattern {
    id: "scale_run",
    name: "Scale Run",
    category: PatternCategory::Melodic,
    length_beats: 4.0,
    notes: SCALE_RUN_NOTES,
};

/// Chord Stabs - C major triads on beats
const CHORD_STABS_NOTES: &[PatternNote] = &[
    // Beat 1 - C major
    PatternNote::new(0.0, 60, 100, 0.5),  // C4
    PatternNote::new(0.0, 64, 100, 0.5),  // E4
    PatternNote::new(0.0, 67, 100, 0.5),  // G4
    // Beat 2 - C major
    PatternNote::new(1.0, 60, 90, 0.5),
    PatternNote::new(1.0, 64, 90, 0.5),
    PatternNote::new(1.0, 67, 90, 0.5),
    // Beat 3 - C major
    PatternNote::new(2.0, 60, 100, 0.5),
    PatternNote::new(2.0, 64, 100, 0.5),
    PatternNote::new(2.0, 67, 100, 0.5),
    // Beat 4 - C major
    PatternNote::new(3.0, 60, 90, 0.5),
    PatternNote::new(3.0, 64, 90, 0.5),
    PatternNote::new(3.0, 67, 90, 0.5),
];

const CHORD_STABS: Pattern = Pattern {
    id: "chord_stabs",
    name: "Chord Stabs",
    category: PatternCategory::Melodic,
    length_beats: 4.0,
    notes: CHORD_STABS_NOTES,
};

/// Simple Lead Line
const LEAD_LINE_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 72, 100, 0.75),  // C5
    PatternNote::new(1.0, 74, 90, 0.5),    // D5
    PatternNote::new(1.5, 76, 100, 0.75),  // E5
    PatternNote::new(2.5, 74, 85, 0.5),    // D5
    PatternNote::new(3.0, 72, 100, 1.0),   // C5
];

const LEAD_LINE: Pattern = Pattern {
    id: "lead_line",
    name: "Lead Line",
    category: PatternCategory::Melodic,
    length_beats: 4.0,
    notes: LEAD_LINE_NOTES,
};

// =============================================================================
// BASS PATTERNS
// =============================================================================

/// Root Pulse - steady quarter notes on C2
const ROOT_PULSE_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 36, 100, 0.9),  // C2
    PatternNote::new(1.0, 36, 95, 0.9),
    PatternNote::new(2.0, 36, 100, 0.9),
    PatternNote::new(3.0, 36, 95, 0.9),
];

const ROOT_PULSE: Pattern = Pattern {
    id: "root_pulse",
    name: "Root Pulse",
    category: PatternCategory::Bass,
    length_beats: 4.0,
    notes: ROOT_PULSE_NOTES,
};

/// Octave Bounce - root and octave alternating
const OCTAVE_BOUNCE_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 36, 100, 0.4),   // C2
    PatternNote::new(0.5, 48, 85, 0.4),    // C3
    PatternNote::new(1.0, 36, 100, 0.4),   // C2
    PatternNote::new(1.5, 48, 85, 0.4),    // C3
    PatternNote::new(2.0, 36, 100, 0.4),   // C2
    PatternNote::new(2.5, 48, 85, 0.4),    // C3
    PatternNote::new(3.0, 36, 100, 0.4),   // C2
    PatternNote::new(3.5, 48, 85, 0.4),    // C3
];

const OCTAVE_BOUNCE: Pattern = Pattern {
    id: "octave_bounce",
    name: "Octave Bounce",
    category: PatternCategory::Bass,
    length_beats: 4.0,
    notes: OCTAVE_BOUNCE_NOTES,
};

/// Walking Bass - simple jazz walk
const WALKING_BASS_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 36, 100, 0.9),  // C2
    PatternNote::new(1.0, 40, 95, 0.9),   // E2
    PatternNote::new(2.0, 43, 100, 0.9),  // G2
    PatternNote::new(3.0, 41, 95, 0.9),   // F2
];

const WALKING_BASS: Pattern = Pattern {
    id: "walking_bass",
    name: "Walking Bass",
    category: PatternCategory::Bass,
    length_beats: 4.0,
    notes: WALKING_BASS_NOTES,
};

/// Synth Bass - syncopated EDM-style
const SYNTH_BASS_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 36, 110, 0.25),
    PatternNote::new(0.75, 36, 100, 0.25),
    PatternNote::new(1.5, 36, 90, 0.25),
    PatternNote::new(2.0, 36, 110, 0.25),
    PatternNote::new(2.75, 36, 100, 0.25),
    PatternNote::new(3.25, 48, 85, 0.25),
    PatternNote::new(3.5, 36, 95, 0.25),
];

const SYNTH_BASS: Pattern = Pattern {
    id: "synth_bass",
    name: "Synth Bass",
    category: PatternCategory::Bass,
    length_beats: 4.0,
    notes: SYNTH_BASS_NOTES,
};

// =============================================================================
// DRUM PATTERNS (using GM drum map)
// =============================================================================
// GM Drum Notes: Kick=36, Snare=38, Closed HH=42, Open HH=46, Crash=49

/// Four on Floor - kick on every beat
const FOUR_ON_FLOOR_NOTES: &[PatternNote] = &[
    PatternNote::new(0.0, 36, 110, 0.25),  // Kick
    PatternNote::new(1.0, 36, 100, 0.25),
    PatternNote::new(2.0, 36, 110, 0.25),
    PatternNote::new(3.0, 36, 100, 0.25),
];

const FOUR_ON_FLOOR: Pattern = Pattern {
    id: "four_on_floor",
    name: "Four on Floor",
    category: PatternCategory::Drums,
    length_beats: 4.0,
    notes: FOUR_ON_FLOOR_NOTES,
};

/// Basic Beat - kick, snare, hi-hat
const BASIC_BEAT_NOTES: &[PatternNote] = &[
    // Kick
    PatternNote::new(0.0, 36, 110, 0.25),
    PatternNote::new(2.0, 36, 110, 0.25),
    // Snare
    PatternNote::new(1.0, 38, 100, 0.25),
    PatternNote::new(3.0, 38, 100, 0.25),
    // Hi-hats
    PatternNote::new(0.0, 42, 80, 0.25),
    PatternNote::new(0.5, 42, 70, 0.25),
    PatternNote::new(1.0, 42, 80, 0.25),
    PatternNote::new(1.5, 42, 70, 0.25),
    PatternNote::new(2.0, 42, 80, 0.25),
    PatternNote::new(2.5, 42, 70, 0.25),
    PatternNote::new(3.0, 42, 80, 0.25),
    PatternNote::new(3.5, 42, 70, 0.25),
];

const BASIC_BEAT: Pattern = Pattern {
    id: "basic_beat",
    name: "Basic Beat",
    category: PatternCategory::Drums,
    length_beats: 4.0,
    notes: BASIC_BEAT_NOTES,
};

/// Breakbeat - syncopated
const BREAKBEAT_NOTES: &[PatternNote] = &[
    // Kick
    PatternNote::new(0.0, 36, 110, 0.25),
    PatternNote::new(1.25, 36, 95, 0.25),
    PatternNote::new(2.5, 36, 110, 0.25),
    // Snare
    PatternNote::new(1.0, 38, 100, 0.25),
    PatternNote::new(2.0, 38, 85, 0.25),
    PatternNote::new(3.0, 38, 100, 0.25),
    PatternNote::new(3.75, 38, 80, 0.25),
    // Hi-hats
    PatternNote::new(0.0, 42, 75, 0.25),
    PatternNote::new(0.5, 42, 65, 0.25),
    PatternNote::new(1.0, 46, 80, 0.25),  // Open
    PatternNote::new(1.5, 42, 65, 0.25),
    PatternNote::new(2.0, 42, 75, 0.25),
    PatternNote::new(2.5, 42, 65, 0.25),
    PatternNote::new(3.0, 46, 80, 0.25),  // Open
    PatternNote::new(3.5, 42, 65, 0.25),
];

const BREAKBEAT: Pattern = Pattern {
    id: "breakbeat",
    name: "Breakbeat",
    category: PatternCategory::Drums,
    length_beats: 4.0,
    notes: BREAKBEAT_NOTES,
};

/// Disco Beat
const DISCO_BEAT_NOTES: &[PatternNote] = &[
    // Four on floor kick
    PatternNote::new(0.0, 36, 110, 0.25),
    PatternNote::new(1.0, 36, 100, 0.25),
    PatternNote::new(2.0, 36, 110, 0.25),
    PatternNote::new(3.0, 36, 100, 0.25),
    // Snare on 2 and 4
    PatternNote::new(1.0, 38, 95, 0.25),
    PatternNote::new(3.0, 38, 95, 0.25),
    // Open hi-hats on off-beats
    PatternNote::new(0.5, 46, 85, 0.25),
    PatternNote::new(1.5, 46, 85, 0.25),
    PatternNote::new(2.5, 46, 85, 0.25),
    PatternNote::new(3.5, 46, 85, 0.25),
];

const DISCO_BEAT: Pattern = Pattern {
    id: "disco_beat",
    name: "Disco Beat",
    category: PatternCategory::Drums,
    length_beats: 4.0,
    notes: DISCO_BEAT_NOTES,
};

// =============================================================================
// PATTERN REGISTRY
// =============================================================================

/// All available patterns
pub const ALL_PATTERNS: &[Pattern] = &[
    // Melodic
    ARPEGGIO_UP,
    ARPEGGIO_DOWN,
    SCALE_RUN,
    CHORD_STABS,
    LEAD_LINE,
    // Bass
    ROOT_PULSE,
    OCTAVE_BOUNCE,
    WALKING_BASS,
    SYNTH_BASS,
    // Drums
    FOUR_ON_FLOOR,
    BASIC_BEAT,
    BREAKBEAT,
    DISCO_BEAT,
];

/// Get a pattern by ID
pub fn get_pattern(id: &str) -> Option<&'static Pattern> {
    ALL_PATTERNS.iter().find(|p| p.id == id)
}

/// Get all pattern info for frontend
pub fn list_patterns() -> Vec<PatternInfo> {
    ALL_PATTERNS.iter().map(PatternInfo::from).collect()
}

/// Get patterns by category
pub fn get_patterns_by_category(category: PatternCategory) -> Vec<PatternInfo> {
    ALL_PATTERNS
        .iter()
        .filter(|p| p.category == category)
        .map(PatternInfo::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pattern_count() {
        assert_eq!(ALL_PATTERNS.len(), 13);
    }

    #[test]
    fn test_get_pattern() {
        let pattern = get_pattern("arpeggio_up").unwrap();
        assert_eq!(pattern.name, "Arpeggio Up");
        assert_eq!(pattern.notes.len(), 8);
    }

    #[test]
    fn test_categories() {
        let melodic = get_patterns_by_category(PatternCategory::Melodic);
        assert_eq!(melodic.len(), 5);

        let bass = get_patterns_by_category(PatternCategory::Bass);
        assert_eq!(bass.len(), 4);

        let drums = get_patterns_by_category(PatternCategory::Drums);
        assert_eq!(drums.len(), 4);
    }
}
