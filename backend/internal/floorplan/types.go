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
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

type Opening struct {
	Type string  `json:"type,omitempty"`
	X    float64 `json:"x,omitempty"`
	Y    float64 `json:"y,omitempty"`
	From string  `json:"from,omitempty"`
	To   string  `json:"to,omitempty"`
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
