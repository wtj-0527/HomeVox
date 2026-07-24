package floorplan

type Bounds struct {
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

type Room struct {
	Name              string  `json:"name"`
	Type              string  `json:"type"`
	ApproximateBounds Bounds  `json:"approximate_bounds"`
	AreaRatio         float64 `json:"area_ratio,omitempty"`
}

type Segment struct {
	ID string  `json:"id,omitempty"`
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

// Opening is a durable local-wall opening. Position is the center fraction from
// the owning wall start. Confirmed=false explicitly preserves unknown building
// parameters rather than fabricating measured dimensions.
type Opening struct {
	ID        string  `json:"id,omitempty"`
	Kind      string  `json:"kind,omitempty"`
	WallID    string  `json:"wallId,omitempty"`
	Position  float64 `json:"position,omitempty"`
	Width     float64 `json:"width,omitempty"`
	Source    string  `json:"source,omitempty"`
	Confirmed bool    `json:"confirmed"`
	Type      string  `json:"type,omitempty"`
	X         float64 `json:"x,omitempty"`
	Y         float64 `json:"y,omitempty"`
	From      string  `json:"from,omitempty"`
	To        string  `json:"to,omitempty"`
}

type Scale struct {
	Unit        string  `json:"unit"`
	PixelToUnit float64 `json:"pixel_to_unit,omitempty"`
}

type Metadata struct {
	Source      string  `json:"source"`
	Confidence  float64 `json:"confidence,omitempty"`
	ImageWidth  int     `json:"image_width,omitempty"`
	ImageHeight int     `json:"image_height,omitempty"`
}

type ParseResult struct {
	Rooms    []Room    `json:"rooms"`
	Walls    []Segment `json:"walls"`
	Doors    []Opening `json:"doors"`
	Windows  []Opening `json:"windows"`
	Scale    Scale     `json:"scale"`
	Metadata Metadata  `json:"metadata"`
}

// ParseResponse is the complete durable editor document. It preserves the
// source metadata returned by the parse endpoint together with the editable
// floorplan result; only the result's walls are subsequently changed by the
// editor.
type ParseResponse struct {
	Filename    string      `json:"filename"`
	ContentType string      `json:"contentType"`
	Size        int         `json:"size"`
	Result      ParseResult `json:"result"`
}
