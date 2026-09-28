// Design patterns & C++ idioms (group cpp-patterns): creational, structural, behavioural, and idioms real codebases use.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { boardDemo as demo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'cpp-patterns';
const boardDemo = (slug: string, title: string, summary: string, boards: Record<string, [string, Board]>) => demo(G, slug, title, summary, boards);
const D = (title: string, text: string, code?: string): { detail: Detail } => ({ detail: { title, text, code } });

// ---------------- creational ----------------
boardDemo('pat-creational', 'Creational patterns', 'Singleton, factory method, abstract factory, builder and prototype: who creates objects, and how callers stay decoupled from concrete types.', {
  singleton: [
    'Singleton',
    {
      panel: 'Singleton',
      code: ['class Config {', 'public:', '  static Config& instance() {', '    static Config c;   // built on first call', '    return c;', '  }', 'private:', '  Config() = default;', '};'],
      nodes: [
        N('a', 40, 380, 290, 110, 'OrderService', 'uses Config', D('OrderService', 'A class that reaches for the global directly. Nothing in its constructor says it needs Config.', 'double OrderService::tax(double x) {\n  return x * Config::instance().taxRate();\n}')),
        N('b', 355, 380, 290, 110, 'Logger', 'uses Config', D('Logger', 'Another hidden user of the same global. Order of use across files decides who creates it first.', 'void Logger::open() {\n  file_.open(Config::instance().logPath());\n}')),
        N('c', 670, 380, 290, 110, 'Cache', 'uses Config', D('Cache', 'A third hidden user. All three now share mutable state through Config.', 'Cache::Cache()\n  : cap_(Config::instance().cacheSize()) {}')),
        N('inst', 355, 590, 290, 110, 'Config::instance()', 'one static object', D('Meyers singleton', 'A function-local static is created on first call. Since C++11 that initialisation is thread-safe, and it is destroyed at exit.', 'Config& Config::instance() {\n  static Config c;  // once, thread-safe\n  return c;\n}')),
        N('test', 40, 810, 920, 110, 'unit test', 'wants a fake Config', D('Testing with a global', 'Tests cannot replace the global, and state leaks between tests. Passing the dependency in fixes both.', 'class OrderService {\n  const Config& cfg_;\npublic:\n  explicit OrderService(const Config& c)\n    : cfg_(c) {}\n};\n\nConfig fake{.taxRate = 0.1};\nOrderService s{fake};  // no global')),
      ],
      edges: ['a>inst', 'b>inst', 'c>inst', 'test>inst'],
      beats: [
        { note: 'A singleton is one global object plus a function that returns it.', hl: [2, 3, 4, 5], hot: { inst: 'current' }, hide: ['test'], rows: [['instances', 1]] },
        { note: 'The function-local static is built on first call, and C++11 makes that thread-safe.', hl: [3], hot: { inst: 'write' }, hide: ['test'], rows: [['init', 'first call, thread-safe', 'ok']] },
        { note: 'Every class calls Config::instance() directly, so the dependency is invisible in their signatures.', hot: { a: 'warn', b: 'warn', c: 'warn', 'a>inst': 'accent', 'b>inst': 'accent', 'c>inst': 'accent' }, hide: ['test'], rows: [['hidden deps', 3, 'warn']] },
        { note: 'Tests can’t swap in a fake Config, and state leaks from one test to the next.', hot: { test: 'fail', 'test>inst': 'fail' }, rows: [['testable', 'no', 'fail']] },
        { note: 'Prefer passing a Config& to constructors, and keep singletons for truly process-wide things like a logger.', hot: { test: 'ok', a: 'ok', b: 'ok', c: 'ok' }, rows: [['fix', 'inject it', 'ok']] },
      ],
    },
  ],
  factory: [
    'Factory method',
    {
      panel: 'Factory',
      code: ['struct Shape { virtual ~Shape() = default;', '               virtual double area() const = 0; };', 'std::unique_ptr<Shape> make(std::string_view kind) {', '  if (kind == "circle") return std::make_unique<Circle>(1);', '  if (kind == "square") return std::make_unique<Square>(2);', '  throw std::invalid_argument("unknown shape");', '}'],
      nodes: [
        N('client', 40, 340, 290, 110, 'client', 'has "circle"', D('Client', 'Code that knows which kind it wants (from config, a file, a user) but not the class.', 'auto s = make(cfg.shape);\nstd::cout << s->area();')),
        N('fac', 355, 340, 290, 110, 'make(kind)', 'factory', D('Factory function', 'Maps a name or parameters to a concrete type and returns it behind the interface.', 'std::unique_ptr<Shape> make(std::string_view k) {\n  if (k == "circle")\n    return std::make_unique<Circle>(1);\n  throw std::invalid_argument("?");\n}')),
        N('iface', 670, 340, 290, 110, 'Shape', 'interface', D('Shape', 'The abstract interface callers program against. Virtual destructor so deleting through Shape* is safe.', 'struct Shape {\n  virtual ~Shape() = default;\n  virtual double area() const = 0;\n};')),
        N('c1', 200, 560, 290, 110, 'Circle', 'concrete', D('Circle', 'One concrete product. Only the factory names it.', 'struct Circle : Shape {\n  double r;\n  explicit Circle(double r) : r(r) {}\n  double area() const override {\n    return 3.14159 * r * r;\n  }\n};')),
        N('c2', 520, 560, 290, 110, 'Square', 'concrete', D('Square', 'Another concrete product behind the same interface.', 'struct Square : Shape {\n  double s;\n  explicit Square(double s) : s(s) {}\n  double area() const override { return s * s; }\n};')),
        N('res', 40, 790, 920, 110, 'std::unique_ptr<Shape>', 'owner returned', D('Returned owner', 'Returning unique_ptr makes ownership explicit: the caller owns it, and it is freed automatically.', 'std::unique_ptr<Shape> s = make("circle");\n// no delete anywhere')),
      ],
      edges: ['client>fac', 'fac>c1', 'fac>c2', 'c1>iface', 'c2>iface', 'fac>res'],
      beats: [
        { note: 'The client knows a name, not a class. make() turns the name into an object.', hl: [2], hot: { client: 'current', fac: 'current', 'client>fac': 'accent' }, hide: ['res'], rows: [['caller knows', '"circle"']] },
        { note: 'It picks the concrete type and returns it behind the Shape interface.', hl: [3], hot: { c1: 'write', iface: 'current', 'fac>c1': 'accent', 'c1>iface': 'accent' }, hide: ['res'], rows: [['created', 'Circle']] },
        { note: 'The caller gets a unique_ptr, so ownership is explicit and nothing leaks.', hot: { res: 'ok', 'fac>res': 'accent' }, rows: [['owner', 'caller', 'ok']] },
        { note: 'Adding a Triangle touches only the factory, not every caller.', hl: [5], hot: { fac: 'current' }, rows: [['callers edited', 0, 'ok']] },
        { note: 'The cost is a heap allocation and virtual calls. If the set of types is closed, std::variant avoids both.', hot: { res: 'warn' }, rows: [['cost', 'alloc + vcall', 'warn']] },
      ],
    },
  ],
  abstract: [
    'Abstract factory',
    {
      panel: 'Abstract factory',
      code: ['struct UiFactory {', '  virtual std::unique_ptr<Button> button() = 0;', '  virtual std::unique_ptr<Menu> menu() = 0;', '};', 'struct MacFactory : UiFactory { /* Mac widgets */ };', 'struct WinFactory : UiFactory { /* Win widgets */ };'],
      nodes: [
        N('app', 40, 310, 290, 110, 'App', 'gets UiFactory&', D('App', 'Builds its UI through the factory interface only, so it never names a platform.', 'void App::build(UiFactory& f) {\n  auto ok = f.button();\n  auto file = f.menu();\n}')),
        N('uf', 355, 310, 290, 110, 'UiFactory', 'abstract', D('UiFactory', 'One interface that creates a whole family of related products.', 'struct UiFactory {\n  virtual ~UiFactory() = default;\n  virtual std::unique_ptr<Button> button() = 0;\n  virtual std::unique_ptr<Menu> menu() = 0;\n};')),
        N('mf', 200, 510, 290, 110, 'MacFactory', 'concrete', D('MacFactory', 'Creates only Mac widgets, so they always match each other.', 'struct MacFactory : UiFactory {\n  std::unique_ptr<Button> button() override {\n    return std::make_unique<MacButton>();\n  }\n};')),
        N('wf', 520, 510, 290, 110, 'WinFactory', 'concrete', D('WinFactory', 'The other family. Chosen once at startup.', 'std::unique_ptr<UiFactory> f = on_windows()\n  ? std::unique_ptr<UiFactory>(new WinFactory)\n  : std::make_unique<MacFactory>();')),
        N('mb', 40, 720, 210, 110, 'MacButton', undefined, D('MacButton', 'A product from the Mac family.', 'struct MacButton : Button {\n  void draw() override;  // Aqua style\n};')),
        N('mm', 270, 720, 210, 110, 'MacMenu', undefined, D('MacMenu', 'Matches MacButton because the same factory made it.', 'struct MacMenu : Menu { void draw() override; };')),
        N('wb', 520, 720, 210, 110, 'WinButton', undefined, D('WinButton', 'A product from the Windows family.', 'struct WinButton : Button { void draw() override; };')),
        N('wm', 750, 720, 210, 110, 'WinMenu', undefined, D('WinMenu', 'Matches WinButton.', 'struct WinMenu : Menu { void draw() override; };')),
      ],
      edges: ['app>uf', 'mf>uf', 'wf>uf', 'mf>mb', 'mf>mm', 'wf>wb', 'wf>wm'],
      beats: [
        { note: 'An abstract factory creates a whole family of related objects through one interface.', hl: [0, 1, 2, 3], hot: { uf: 'current', app: 'current', 'app>uf': 'accent' }, rows: [['families', 2]] },
        { note: 'Pick MacFactory once at startup, and every button and menu comes out matching.', hl: [4], hot: { mf: 'current', mb: 'write', mm: 'write', 'mf>mb': 'accent', 'mf>mm': 'accent' }, rows: [['family', 'Mac', 'ok']] },
        { note: 'Swap in WinFactory and the App code doesn’t change at all.', hl: [5], hot: { wf: 'current', wb: 'write', wm: 'write', 'wf>wb': 'accent', 'wf>wm': 'accent' }, rows: [['App changes', 0, 'ok']] },
        { note: 'Use it when products must be consistent with each other, like a UI theme or a database driver.', hot: { uf: 'ok' }, rows: [['use when', 'families must match']] },
      ],
    },
  ],
  builder: [
    'Builder',
    {
      panel: 'Builder',
      code: ['auto req = HttpRequest::Builder{}', '  .url("https://api.example.com/users")', '  .method("POST")', '  .header("Auth", token)', '  .timeout(5s)', '  .build();   // validates, returns HttpRequest'],
      nodes: [
        N('b', 40, 300, 440, 110, 'Builder', 'collects settings', D('Builder', 'A mutable helper with one named setter per option. Each returns *this so calls chain.', 'struct Builder {\n  Builder& url(std::string u) {\n    url_ = std::move(u); return *this;\n  }\n  HttpRequest build() const;\n};')),
        N('prod', 520, 300, 440, 110, 'HttpRequest', 'immutable', D('HttpRequest', 'The product. Once built it never changes, so it is safe to share between threads.', 'class HttpRequest {\n  friend struct Builder;\n  std::string url_, method_;\n  std::chrono::seconds timeout_;\npublic:\n  const std::string& url() const;\n};')),
        N('f1', 40, 480, 210, 100, 'url', undefined, D('url()', 'A required option. build() fails if it was never set.', 'b.url("https://example.com");')),
        N('f2', 270, 480, 210, 100, 'method', undefined, D('method()', 'An optional option with a default (GET).', 'b.method("POST");')),
        N('f3', 500, 480, 210, 100, 'header', undefined, D('header()', 'Can be called many times; the builder accumulates.', 'b.header("Auth", token)\n .header("Accept", "json");')),
        N('f4', 730, 480, 230, 100, 'timeout', undefined, D('timeout()', 'Named, so nobody confuses seconds with retries.', 'using namespace std::chrono_literals;\nb.timeout(5s);')),
        N('val', 40, 660, 920, 110, 'build()', 'validate, then construct', D('build()', 'Checks the combination once, then constructs the product.', 'HttpRequest Builder::build() const {\n  if (url_.empty())\n    throw std::logic_error("url required");\n  return HttpRequest{*this};\n}')),
        N('res', 40, 840, 920, 110, 'req', 'ready to send', D('Designated initialisers', 'In C++20 an options struct with defaults often replaces a builder.', 'struct Opts {\n  std::string url;\n  std::string method = "GET";\n  std::chrono::seconds timeout{30};\n};\nsend(Opts{.url = u, .method = "POST"});')),
      ],
      edges: ['b>prod', 'val>res'],
      beats: [
        { note: 'A constructor with eight parameters is unreadable, and most of them are optional.', hot: { prod: 'warn' }, hide: ['f1', 'f2', 'f3', 'f4', 'val', 'res'], rows: [['ctor params', 8, 'warn']] },
        { note: 'The builder collects settings one named call at a time, each returning *this.', hl: [1, 2, 3, 4], hot: { b: 'current', f1: 'write', f2: 'write', f3: 'write', f4: 'write' }, hide: ['val', 'res'], rows: [['options set', 4]] },
        { note: 'build() checks the combination once and constructs the final object.', hl: [5], hot: { val: 'current', 'b>prod': 'accent' }, hide: ['res'], rows: [['validated', 'yes', 'ok']] },
        { note: 'The result can be immutable, since it’s fully formed at construction.', hot: { res: 'ok', prod: 'ok', 'val>res': 'accent' }, rows: [['mutable after build', 'no', 'ok']] },
        { note: 'In C++20, designated initialisers on an options struct often do the same job with less code.', hot: { res: 'current' }, rows: [['alternative', 'Opts{.url = …}']] },
      ],
    },
  ],
  prototype: [
    'Prototype',
    {
      panel: 'Prototype',
      code: ['struct Shape {', '  virtual std::unique_ptr<Shape> clone() const = 0;', '};', 'struct Circle : Shape {', '  std::unique_ptr<Shape> clone() const override {', '    return std::make_unique<Circle>(*this);', '  }', '};'],
      nodes: [
        N('reg', 40, 370, 440, 110, 'palette', 'prototypes by name', D('Prototype registry', 'A map from names to ready-made example objects.', 'std::map<std::string,\n         std::unique_ptr<Shape>> palette;\npalette["dot"] = std::make_unique<Circle>(2);')),
        N('p', 520, 370, 440, 110, 'Shape* proto', 'really a Circle', D('Base pointer', 'The editor only has a Shape*. Copying *p directly would slice.', 'Shape* p = palette["dot"].get();\n// Shape s = *p;  // slices! (and Shape is abstract)')),
        N('copy', 520, 580, 440, 110, 'proto->clone()', 'virtual copy', D('clone()', 'A virtual copy constructor: each class copies itself with its real type.', 'auto copy = p->clone();\n// dynamic type: Circle')),
        N('newo', 520, 790, 440, 110, 'new Circle', 'same fields', D('The copy', 'A full copy of the Circle, including radius and style.', 'copy->move_to(x, y);\ncanvas.add(std::move(copy));')),
        N('user', 40, 790, 440, 110, 'editor', 'drag from palette', D('Editor', 'Creates objects without knowing any concrete type.', 'void on_drop(std::string_view name) {\n  canvas.add(palette.at(name)->clone());\n}')),
      ],
      edges: ['reg>p', 'p>copy', 'copy>newo', 'user>reg'],
      beats: [
        { note: 'Copying through a base pointer slices: Shape s = *p keeps only the Shape part.', hot: { p: 'current' }, hide: ['copy', 'newo'], rows: [['copy via base', 'slices', 'fail']] },
        { note: 'clone() is a virtual copy constructor, so each class copies itself correctly.', hl: [4, 5, 6], hot: { copy: 'current', 'p>copy': 'accent' }, hide: ['newo'], rows: [['dispatch', 'virtual']] },
        { note: 'The editor clones from a palette of prototypes without knowing any concrete type.', hot: { user: 'current', newo: 'ok', 'copy>newo': 'accent', 'user>reg': 'accent' }, rows: [['types named', 0, 'ok']] },
        { note: 'Each clone is a heap allocation. For value types, copying a std::variant needs none.', hot: { newo: 'warn' }, rows: [['cost', 'alloc per clone', 'warn']] },
      ],
    },
  ],
});

// ---------------- structural: wrappers ----------------
const SUBS = ['Demuxer', 'Decoder', 'Scaler', 'Encoder', 'Muxer'];
const SUB_CODE: Record<string, string> = {
  Demuxer: 'Demuxer dmx{"in.mov"};\nwhile (auto pkt = dmx.next()) { /* … */ }',
  Decoder: 'Decoder dec{dmx.video_codec()};\nFrame f = dec.decode(pkt);',
  Scaler: 'Scaler sc{1920, 1080, 1280, 720};\nFrame small = sc.scale(f);',
  Encoder: 'Encoder enc{Codec::H264, {.crf = 23}};\nPacket out = enc.encode(small);',
  Muxer: 'Muxer mux{"out.mp4"};\nmux.write(out);\nmux.finish();',
};
const facadeEdges = SUBS.map((_, i) => `fa>s${i}`);

boardDemo('pat-wrappers', 'Adapter, decorator, proxy, facade', 'Four ways to put an object in front of another: translate an API, add behaviour, control access, or simplify a subsystem.', {
  adapter: [
    'Adapter',
    {
      panel: 'Adapter',
      code: ['struct Logger { virtual void log(std::string_view) = 0; };', 'class SpdAdapter : public Logger {', '  spdlog::logger& impl_;', 'public:', '  explicit SpdAdapter(spdlog::logger& l) : impl_(l) {}', '  void log(std::string_view m) override { impl_.info(m); }', '};'],
      nodes: [
        N('client', 40, 340, 290, 110, 'your code', 'calls Logger', D('Your code', 'Depends only on your own small interface.', 'void Orders::place(Order o) {\n  log_.log("placing order");\n}')),
        N('iface', 355, 340, 290, 110, 'Logger', 'your interface', D('Target interface', 'The API your codebase wants: small, stable, yours.', 'struct Logger {\n  virtual ~Logger() = default;\n  virtual void log(std::string_view) = 0;\n};')),
        N('ad', 355, 540, 290, 110, 'SpdAdapter', 'translates', D('Adapter', 'Implements your interface by calling the library. The only class that includes spdlog.', 'class SpdAdapter : public Logger {\n  spdlog::logger& impl_;\npublic:\n  void log(std::string_view m) override {\n    impl_.info(m);\n  }\n};')),
        N('lib', 355, 740, 290, 110, 'spdlog::logger', '3rd-party API', D('Adaptee', 'The existing class with an incompatible interface. You can’t or shouldn’t change it.', 'auto l = spdlog::stdout_color_mt("app");\nl->info("hello {}", name);')),
      ],
      edges: ['client>iface', 'ad>iface', 'ad>lib'],
      beats: [
        { note: 'Your code talks to a Logger interface, while the library speaks its own API.', hl: [0], hot: { client: 'current', iface: 'current', 'client>iface': 'accent' }, hide: ['ad'], rows: [['APIs', 2]] },
        { note: 'The adapter implements your interface and forwards each call in the library’s terms.', hl: [1, 2, 3, 4, 5], hot: { ad: 'current', 'ad>lib': 'accent', 'ad>iface': 'accent' }, rows: [['files including spdlog', 1, 'ok']] },
        { note: 'Swapping spdlog for another library means one new adapter, not a codebase-wide edit.', hot: { lib: 'warn', ad: 'write' }, rows: [['callers edited', 0, 'ok']] },
        { note: 'This is the platform layer from Large C++ projects, one class at a time.', hot: { iface: 'ok' }, rows: [['cost', 'one virtual call']] },
      ],
    },
  ],
  decorator: [
    'Decorator',
    {
      panel: 'Decorator',
      code: ['struct Stream { virtual void write(std::string_view) = 0; };', 'struct File : Stream { /* writes bytes */ };', 'struct Gzip : Stream {', '  std::unique_ptr<Stream> next;', '  void write(std::string_view s) override {', '    next->write(compress(s));', '  }', '};', 'auto s = make_unique<Gzip>(make_unique<File>("a.gz"));'],
      nodes: [
        N('cl', 40, 420, 290, 100, 'caller', 's->write(data)', D('Caller', 'Holds a Stream and writes to it. It doesn’t know how many layers there are.', 'std::unique_ptr<Stream> s = open_log();\ns->write("event\\n");')),
        N('gz', 355, 420, 290, 100, 'Gzip', 'compresses', D('Decorator', 'Is a Stream and has a Stream. Adds behaviour, then forwards.', 'struct Gzip : Stream {\n  std::unique_ptr<Stream> next;\n  void write(std::string_view s) override {\n    next->write(compress(s));\n  }\n};')),
        N('enc', 355, 590, 290, 100, 'Encrypt', 'another layer', D('Another decorator', 'Stacks on top of or below Gzip. Order matters: compress, then encrypt.', 'auto s = make_unique<Gzip>(\n  make_unique<Encrypt>(key,\n    make_unique<File>("a.gz.enc")));')),
        N('f', 355, 760, 290, 100, 'File', 'writes bytes', D('Concrete component', 'The innermost object that does the real work.', 'struct File : Stream {\n  std::ofstream out;\n  void write(std::string_view s) override {\n    out.write(s.data(), s.size());\n  }\n};')),
        N('iface', 700, 590, 260, 100, 'Stream', 'one interface', D('Component interface', 'Every layer implements it, so layers are interchangeable.', 'struct Stream {\n  virtual ~Stream() = default;\n  virtual void write(std::string_view) = 0;\n};')),
      ],
      edges: ['cl>gz', 'gz>enc', 'enc>f', 'gz>f'],
      beats: [
        { note: 'Gzip is a Stream that wraps another Stream, adding behaviour around each write.', hl: [2, 3, 4, 5, 6], hot: { gz: 'current', 'gz>f': 'accent' }, hide: ['enc'], rows: [['layers', 2]] },
        { note: 'The caller only sees a Stream, so it can’t tell how many layers there are.', hl: [8], hot: { cl: 'current', 'cl>gz': 'accent', iface: 'current' }, hide: ['enc'], rows: [['caller knows', 'Stream']] },
        { note: 'Stack another decorator and each write is compressed, then encrypted, then stored.', hot: { enc: 'write', gz: 'write', f: 'write', 'gz>enc': 'accent', 'enc>f': 'accent' }, hide: ['gz>f'], rows: [['layers', 3]] },
        { note: 'Layers compose at run time. Each one costs a virtual call and usually a heap object.', hot: { enc: 'warn' }, hide: ['gz>f'], rows: [['cost per layer', 'vcall + alloc', 'warn']] },
      ],
    },
  ],
  proxy: [
    'Proxy',
    {
      panel: 'Proxy',
      code: ['class LazyImage : public Image {', '  std::string path_;', '  mutable std::unique_ptr<RealImage> real_;', 'public:', '  void draw() const override {', '    if (!real_) real_ = std::make_unique<RealImage>(path_);', '    real_->draw();', '  }', '};'],
      nodes: [
        N('cl', 40, 410, 290, 110, 'gallery', '100 thumbnails', D('Client', 'Uses Image objects. Unaware some are proxies.', 'std::vector<std::unique_ptr<Image>> imgs;\nfor (auto& p : paths)\n  imgs.push_back(std::make_unique<LazyImage>(p));')),
        N('px', 355, 410, 290, 110, 'LazyImage', 'proxy, 40 B', D('Proxy', 'Same interface as the real object; creates it only when first needed.', 'void LazyImage::draw() const {\n  if (!real_)\n    real_ = std::make_unique<RealImage>(path_);\n  real_->draw();\n}')),
        N('iface', 690, 410, 270, 110, 'Image', 'same interface', D('Subject interface', 'Proxy and real object both implement it.', 'struct Image {\n  virtual ~Image() = default;\n  virtual void draw() const = 0;\n};')),
        N('real', 355, 620, 290, 110, 'RealImage', '8 MB decoded', D('Real subject', 'The expensive object: decodes the whole file in its constructor.', 'RealImage::RealImage(const std::string& p)\n  : pixels_(decode_jpeg(read_file(p))) {}')),
        N('disk', 355, 830, 290, 110, 'disk', 'photo.jpg', D('Disk', 'Reading and decoding is the cost the proxy defers.', '// 8 MB per decoded 2000×1000 RGBA image')),
      ],
      edges: ['cl>px', 'px>iface', 'px>real', 'real>disk'],
      beats: [
        { note: 'A proxy has the same interface as the real object but controls access to it.', hot: { cl: 'current', px: 'current', 'cl>px': 'accent' }, hide: ['real', 'disk'], rows: [['loaded', 0]] },
        { note: 'Constructing 100 LazyImages is cheap, since nothing is loaded yet.', hot: { px: 'ok' }, hide: ['real', 'disk'], rows: [['memory', '4 KB', 'ok']] },
        { note: 'The first draw() loads the real image, and later calls go straight to it.', hl: [5, 6], hot: { real: 'write', disk: 'read', 'px>real': 'accent', 'real>disk': 'accent' }, rows: [['loaded', 1], ['memory', '8 MB']] },
        { note: 'Smart pointers are proxies too, and so are RPC stubs and copy-on-write handles.', hot: { px: 'current' }, rows: [['kinds', 'lazy, remote, guard']] },
      ],
    },
  ],
  facade: [
    'Facade',
    {
      panel: 'Facade',
      code: ['class Video {', 'public:', '  static void convert(std::string in, std::string out);', '};', '// inside: Demuxer, Decoder, Scaler, Encoder, Muxer'],
      nodes: [
        N('app', 355, 250, 290, 110, 'app', 'Video::convert()', D('App', 'Wants the common case in one line.', 'Video::convert("in.mov", "out.mp4");')),
        N('fa', 355, 440, 290, 110, 'Video', 'facade', D('Facade', 'One simple entry point that drives the subsystems in the right order.', 'void Video::convert(std::string in,\n                   std::string out) {\n  Demuxer d{in}; Decoder dec{d.codec()};\n  Encoder e{Codec::H264}; Muxer m{out};\n  while (auto p = d.next())\n    m.write(e.encode(dec.decode(*p)));\n  m.finish();\n}')),
        ...SUBS.map((s, i) => N(`s${i}`, 40 + i * 186, 660, 170, 110, s, undefined, D(s, `One subsystem the facade coordinates. Experts can still use it directly.`, SUB_CODE[s]))),
      ],
      edges: ['app>fa', ...facadeEdges],
      beats: [
        { note: 'Encoding a video needs five subsystems used in the right order with the right settings.', hot: { s0: 'warn', s1: 'warn', s2: 'warn', s3: 'warn', s4: 'warn' }, hide: ['fa'], rows: [['classes to learn', 5, 'warn']] },
        { note: 'A facade exposes one simple call for the common case.', hl: [2], hot: { fa: 'current', 'app>fa': 'accent' }, rows: [['classes to learn', 1, 'ok']] },
        { note: 'Inside, it drives the subsystems in order.', hl: [4], hot: { s0: 'write', s1: 'write', s2: 'write', s3: 'write', s4: 'write', ...Object.fromEntries(facadeEdges.map((e) => [e, 'accent'])) }, rows: [['calls made', 5]] },
        { note: 'Experts can still use the subsystems directly. The facade adds a door without locking the others.', hot: { fa: 'ok', s3: 'current' }, rows: [['subsystems hidden', 'no']] },
      ],
    },
  ],
});

// ---------------- structural: structure ----------------
const CHARS = ['a', 'b', 'a', 'a', 'b'];
const charEdges = CHARS.map((c, i) => `c${i}>g${c}`);

boardDemo('pat-structure', 'Composite, bridge, flyweight', 'Treat trees uniformly, split two dimensions of variation, and share heavy immutable state.', {
  composite: [
    'Composite',
    {
      panel: 'Composite',
      code: ['struct Node {', '  virtual ~Node() = default;', '  virtual std::size_t size() const = 0;', '};', 'struct File : Node { std::size_t bytes; };', 'struct Dir : Node {', '  std::vector<std::unique_ptr<Node>> kids;', '  std::size_t size() const override;  // sum kids', '};'],
      nodes: [
        N('root', 355, 400, 290, 100, 'Dir /', 'size() = ?', D('Composite', 'A Dir is a Node that owns other Nodes. Its size() asks each child.', 'std::size_t Dir::size() const {\n  std::size_t n = 0;\n  for (auto& k : kids) n += k->size();\n  return n;\n}')),
        N('a', 100, 570, 290, 100, 'Dir src', 'size() = ?', D('Nested composite', 'A directory inside a directory. Same interface, same code.', 'auto src = std::make_unique<Dir>();\nsrc->kids.push_back(std::make_unique<File>(25000));\nroot.kids.push_back(std::move(src));')),
        N('b', 610, 570, 290, 100, 'File README', '2 KB', D('Leaf', 'A File has no children. size() is just its bytes.', 'struct File : Node {\n  std::size_t bytes;\n  std::size_t size() const override {\n    return bytes;\n  }\n};')),
        N('c', 40, 760, 290, 100, 'File a.cpp', '25 KB', D('Leaf', 'Another leaf under src.', 'File{25000}')),
        N('d', 355, 760, 290, 100, 'File b.cpp', '15 KB', D('Leaf', 'Another leaf under src.', 'File{15000}')),
      ],
      edges: ['root>a', 'root>b', 'a>c', 'a>d'],
      beats: [
        { note: 'Files and directories share one Node interface, so a tree mixes both freely.', hl: [0, 1, 2, 3], hot: { root: 'current' }, rows: [['nodes', 5]] },
        { note: 'size() on a file just returns its bytes.', hl: [4], hot: { b: 'write', c: 'write', d: 'write' }, rows: [['leaves', 3]] },
        { note: 'size() on a directory asks each child, without caring whether the child is a file or a directory.', hl: [7], hot: { a: 'current', 'a>c': 'accent', 'a>d': 'accent' }, sub: { a: 'size() = 40 KB' }, rows: [['src', '40 KB']] },
        { note: 'The root sums its children, so one call walks the whole tree.', hot: { root: 'ok', 'root>a': 'accent', 'root>b': 'accent' }, sub: { a: 'size() = 40 KB', root: 'size() = 42 KB' }, rows: [['total', '42 KB', 'ok']] },
        { note: 'Widget trees, scene graphs and compiler ASTs are all composites.', hot: { root: 'ok' }, sub: { a: 'size() = 40 KB', root: 'size() = 42 KB' }, rows: [['seen in', 'UI, games, compilers']] },
      ],
    },
  ],
  bridge: [
    'Bridge',
    {
      panel: 'Bridge',
      code: ['class Renderer {                  // implementation side', 'public: virtual void circle(float x, float y, float r) = 0;', '};', 'class Shape {                     // abstraction side', 'protected: Renderer& r_;', 'public: explicit Shape(Renderer& r) : r_(r) {}', '  virtual void draw() = 0;', '};'],
      nodes: [
        N('sh', 40, 370, 440, 110, 'Shape', 'abstraction', D('Abstraction', 'What the app works with. It holds a reference to an implementation.', 'class Shape {\nprotected:\n  Renderer& r_;\npublic:\n  explicit Shape(Renderer& r) : r_(r) {}\n  virtual void draw() = 0;\n};')),
        N('re', 520, 370, 440, 110, 'Renderer', 'implementation', D('Implementor', 'Low-level primitives each backend provides.', 'struct Renderer {\n  virtual ~Renderer() = default;\n  virtual void circle(float, float, float) = 0;\n  virtual void rect(float, float, float, float) = 0;\n};')),
        N('ci', 40, 570, 210, 110, 'Circle', undefined, D('Refined abstraction', 'Draws itself in terms of Renderer primitives only.', 'struct Circle : Shape {\n  float x, y, rad;\n  void draw() override { r_.circle(x, y, rad); }\n};')),
        N('sq', 270, 570, 210, 110, 'Square', undefined, D('Refined abstraction', 'Another shape; knows nothing about OpenGL or Metal.', 'void Square::draw() { r_.rect(x, y, s, s); }')),
        N('gl', 520, 570, 210, 110, 'OpenGL', undefined, D('Concrete implementor', 'One backend.', 'struct GlRenderer : Renderer {\n  void circle(float x, float y, float r) override;\n};')),
        N('me', 750, 570, 210, 110, 'Metal', undefined, D('Concrete implementor', 'Another backend, added without touching any Shape.', 'struct MetalRenderer : Renderer {\n  void circle(float x, float y, float r) override;\n};')),
        N('res', 40, 770, 920, 110, 'N × M subclasses', 'GLCircle, MetalCircle, …', D('Class count', 'Without a bridge, every shape needs a subclass per backend.', '// 2 shapes × 2 APIs = 4 classes\n// 10 shapes × 3 APIs = 30 classes\n// with a bridge: 10 + 3 = 13')),
      ],
      edges: ['ci>sh', 'sq>sh', 'gl>re', 'me>re', 'sh>re'],
      beats: [
        { note: 'Shapes times rendering APIs would need a class for every combination.', hot: { res: 'warn' }, hide: ['sh>re'], rows: [['classes', '10 × 3 = 30', 'warn']] },
        { note: 'The bridge splits them, with Shape holding a reference to a Renderer.', hl: [4, 5], hot: { sh: 'current', re: 'current', 'sh>re': 'accent' }, rows: [['link', 'Renderer&']] },
        { note: 'Circle::draw() calls r_.circle(), which OpenGL or Metal implements.', hl: [0, 1], hot: { ci: 'current', gl: 'write', 'ci>sh': 'accent', 'gl>re': 'accent' }, rows: [['calls', 'draw → circle']] },
        { note: 'Now it’s N shapes plus M renderers, and each side varies on its own.', hot: { res: 'ok' }, label: { res: 'N + M classes' }, sub: { res: '10 + 3 = 13' }, rows: [['classes', '10 + 3 = 13', 'ok']] },
      ],
    },
  ],
  flyweight: [
    'Flyweight',
    {
      panel: 'Flyweight',
      code: ['struct Glyph { Bitmap bmp; Metrics m; };    // shared, ~2 KB', 'struct Char  { const Glyph* g; int x, y; };  // per use, 16 B', 'std::unordered_map<char32_t, Glyph> cache;'],
      nodes: [
        N('doc', 40, 200, 920, 110, 'document', '100,000 characters', D('Document', 'Lots of small objects that would each carry a copy of heavy data.', 'std::vector<Char> text;  // 100,000 entries')),
        ...CHARS.map((c, i) => N(`c${i}`, 40 + i * 186, 390, 170, 100, `'${c}' @${i}`, undefined, D('Char (extrinsic state)', 'Only what differs per use: position, plus a pointer to the shared glyph.', 'struct Char {\n  const Glyph* g;  // shared\n  int x, y;        // per use\n};'))),
        N('ga', 100, 610, 350, 120, 'Glyph a', '2 KB bitmap', D('Flyweight (intrinsic state)', 'Heavy, immutable data shared by every use of the letter.', 'const Glyph& glyph(char32_t c) {\n  auto [it, _] = cache.try_emplace(c, load(c));\n  return it->second;\n}')),
        N('gb', 550, 610, 350, 120, 'Glyph b', '2 KB bitmap', D('Flyweight', 'One per distinct letter, not per character in the text.', '// cache.size() == distinct letters')),
        N('mem', 40, 820, 920, 120, 'memory', '100,000 × 2 KB', D('Memory maths', 'Per-use state stays small; shared state is paid once.', '// naive:     100,000 × 2 KB  ≈ 200 MB\n// flyweight: 100,000 × 16 B + 2 × 2 KB\n//          ≈ 1.6 MB')),
      ],
      edges: charEdges,
      beats: [
        { note: 'A document with 100,000 characters can’t afford a 2 KB bitmap per character.', hot: { mem: 'fail' }, label: { mem: '≈ 200 MB' }, sub: { c0: 'own bitmap', c1: 'own bitmap', c2: 'own bitmap', c3: 'own bitmap', c4: 'own bitmap' }, hide: ['ga', 'gb'], rows: [['memory', '200 MB', 'fail']] },
        { note: 'Split the heavy shared state, the glyph, from the light per-use state, the position.', hl: [0, 1], hot: { ga: 'current', gb: 'current' }, hide: charEdges, rows: [['glyphs', 2]] },
        { note: 'Each Char points into the cache, so there is one bitmap per distinct letter.', hl: [2], hot: Object.fromEntries(charEdges.map((e) => [e, 'accent'])), rows: [['bitmaps', 2, 'ok']] },
        { note: 'Memory drops to 100,000 × 16 B plus a few glyphs, about 1.6 MB.', hot: { mem: 'ok' }, label: { mem: '≈ 1.6 MB' }, sub: { mem: '100,000 × 16 B + 2 glyphs' }, rows: [['memory', '1.6 MB', 'ok']] },
        { note: 'Shared state must be immutable, or one change shows up everywhere.', hot: { ga: 'warn', gb: 'warn' }, label: { mem: '≈ 1.6 MB' }, rows: [['glyph', 'const', 'ok']] },
      ],
    },
  ],
});

// ---------------- behavioural: dispatch ----------------
boardDemo('pat-dispatch', 'Strategy, state, template method, command', 'Swap an algorithm, change behaviour by phase, fix a skeleton with hooks, and turn requests into undoable objects.', {
  strategy: [
    'Strategy',
    {
      panel: 'Strategy',
      code: ['class Compressor {', '  std::function<Bytes(Bytes)> algo_;', 'public:', '  explicit Compressor(std::function<Bytes(Bytes)> a)', '    : algo_(std::move(a)) {}', '  Bytes run(Bytes in) { return algo_(std::move(in)); }', '};', 'Compressor c{zstd_compress};   // or lz4, or a lambda'],
      nodes: [
        N('ctx', 355, 370, 290, 110, 'Compressor', 'context', D('Context', 'Holds a strategy and delegates the varying step to it.', 'Compressor c{lz4_compress};\nBytes packed = c.run(raw);')),
        N('s1', 40, 580, 290, 110, 'zstd', 'best ratio', D('Strategy: zstd', 'A plain function works as a strategy.', 'Bytes zstd_compress(Bytes in) {\n  return zstd::compress(in, /*level*/ 19);\n}')),
        N('s2', 355, 580, 290, 110, 'lz4', 'fastest', D('Strategy: lz4', 'Same signature, different trade-off.', 'Bytes lz4_compress(Bytes in);')),
        N('s3', 670, 580, 290, 110, 'lambda', 'in tests', D('Strategy: lambda', 'Tests can pass an identity lambda and check the rest of the pipeline.', 'Compressor c{[](Bytes b) { return b; }};')),
        N('res', 40, 790, 920, 110, 'run(bytes)', '—', D('Compile-time strategy', 'A template parameter fixes the strategy at compile time and lets the call inline.', 'template <class Algo>\nstruct Compressor {\n  Algo algo;\n  Bytes run(Bytes b) { return algo(std::move(b)); }\n};')),
      ],
      edges: ['ctx>s1', 'ctx>s2', 'ctx>s3'],
      beats: [
        { note: 'Strategy puts an interchangeable algorithm behind one call.', hl: [0, 1], hot: { ctx: 'current' }, rows: [['strategies', 3]] },
        { note: 'This Compressor is built with zstd, and run() forwards to it.', hl: [7, 5], hot: { s1: 'current', 'ctx>s1': 'accent', res: 'write' }, sub: { res: '→ zstd' }, rows: [['using', 'zstd']] },
        { note: 'Swap in lz4 for speed without touching Compressor.', hot: { s2: 'current', 'ctx>s2': 'accent', res: 'write' }, sub: { res: '→ lz4' }, rows: [['using', 'lz4']] },
        { note: 'In C++ a strategy is often just a std::function or a template parameter, with no class hierarchy at all.', hl: [1], hot: { s3: 'current', 'ctx>s3': 'accent' }, sub: { res: '→ lambda' }, rows: [['hierarchy', 'none', 'ok']] },
        { note: 'Template parameters resolve at compile time and inline, while std::function can change at run time.', hot: { res: 'ok' }, sub: { res: 'template: inlined' }, rows: [['std::function', 'runtime swap'], ['template', 'zero overhead']] },
      ],
    },
  ],
  state: [
    'State',
    {
      panel: 'State',
      code: ['struct Conn;', 'struct State { virtual void on_data(Conn&) = 0; };', 'struct Handshake : State { void on_data(Conn&) override; };', 'struct Open      : State { void on_data(Conn&) override; };', 'struct Closed    : State { void on_data(Conn&) override; };', 'struct Conn { std::unique_ptr<State> st; };'],
      nodes: [
        N('conn', 355, 290, 290, 110, 'Conn', 'st → current state', D('Context', 'Forwards every event to its current state object.', 'void Conn::feed(Bytes b) {\n  st->on_data(*this);  // behaviour depends on phase\n}')),
        N('hs', 40, 500, 290, 110, 'Handshake', undefined, D('State: Handshake', 'Handles TLS setup, then replaces itself.', 'void Handshake::on_data(Conn& c) {\n  if (tls_done(c))\n    c.st = std::make_unique<Open>();\n}')),
        N('op', 355, 500, 290, 110, 'Open', undefined, D('State: Open', 'Normal data flow.', 'void Open::on_data(Conn& c) {\n  if (c.peer_closed())\n    c.st = std::make_unique<Closed>();\n  else c.deliver();\n}')),
        N('cl', 670, 500, 290, 110, 'Closed', undefined, D('State: Closed', 'Ignores further data.', 'void Closed::on_data(Conn&) {}  // drop')),
        N('ev', 40, 720, 920, 110, 'event', '—', D('variant alternative', 'For a small closed set of states, a variant avoids heap objects and virtual calls.', 'using St = std::variant<Handshake, Open, Closed>;\nstd::visit([&](auto& s) { s.on_data(c); }, st);')),
      ],
      edges: ['conn>hs', 'conn>op', 'conn>cl', 'hs>op', 'op>cl'],
      beats: [
        { note: 'A connection behaves differently in each phase, and a switch on an enum spreads into every method.', hot: { conn: 'warn' }, rows: [['phases', 3]] },
        { note: 'State objects hold the behaviour, and Conn just forwards to whichever is current.', hl: [1, 5], hot: { conn: 'current', hs: 'current', 'conn>hs': 'accent' }, sub: { ev: 'bytes arrive' }, rows: [['state', 'Handshake']] },
        { note: 'Handshake finishes and replaces itself with Open.', hl: [2], hot: { op: 'current', 'hs>op': 'accent', 'conn>op': 'accent' }, sub: { ev: 'TLS done' }, rows: [['state', 'Open', 'ok']] },
        { note: 'The peer hangs up, so Open moves to Closed, which ignores further data.', hl: [3, 4], hot: { cl: 'current', 'op>cl': 'accent', 'conn>cl': 'accent' }, sub: { ev: 'FIN received' }, rows: [['state', 'Closed', 'warn']] },
        { note: 'For a small, closed set of states, std::variant plus std::visit does the same without heap objects.', hot: { ev: 'ok' }, label: { ev: 'std::variant<Handshake, Open, Closed>' }, sub: { ev: 'no heap, no vtable' }, rows: [['alternative', 'variant']] },
      ],
    },
  ],
  template: [
    'Template method',
    {
      panel: 'Template method',
      code: ['class Report {', 'public:', '  void render() {             // fixed skeleton', '    header(); body(); footer();', '  }', 'private:', '  virtual void header() {}', '  virtual void body() = 0;   // subclasses fill in', '  virtual void footer() {}', '};'],
      nodes: [
        N('base', 355, 440, 290, 110, 'Report::render', 'fixed order', D('Template method', 'A non-virtual function that fixes the algorithm and calls virtual hooks.', 'void Report::render() {\n  header();\n  body();\n  footer();\n}')),
        N('h', 40, 640, 290, 110, 'header()', 'default hook', D('Hook with default', 'Subclasses may override; most don’t.', 'virtual void header() { out << "== report ==\\n"; }')),
        N('b', 355, 640, 290, 110, 'body()', 'must override', D('Required hook', 'Pure virtual: every report provides its own body.', 'virtual void body() = 0;')),
        N('f', 670, 640, 290, 110, 'footer()', 'default hook', D('Hook with default', 'An empty default is common.', 'virtual void footer() {}')),
        N('sub', 355, 840, 290, 110, 'SalesReport', 'overrides body', D('Concrete class', 'Fills in only the step that differs.', 'struct SalesReport : Report {\nprivate:\n  void body() override {\n    for (auto& s : sales) out << s << "\\n";\n  }\n};')),
      ],
      edges: ['base>h', 'base>b', 'base>f', 'sub>b'],
      beats: [
        { note: 'The base class owns the algorithm’s order, and subclasses fill in steps.', hl: [2, 3, 4], hot: { base: 'current' }, hide: ['sub'], rows: [['hooks', 3]] },
        { note: 'render() calls header, body and footer, always in that order.', hl: [3], hot: { h: 'write', b: 'write', f: 'write', 'base>h': 'accent', 'base>b': 'accent', 'base>f': 'accent' }, hide: ['sub'], rows: [['order', 'fixed', 'ok']] },
        { note: 'SalesReport overrides only body(). It can’t reorder or skip the skeleton.', hl: [7], hot: { sub: 'current', 'sub>b': 'accent', b: 'current' }, rows: [['overridden', 'body']] },
        { note: 'Private virtual hooks behind a public non-virtual function is the NVI idiom.', hl: [5, 6, 7, 8], hot: { base: 'ok' }, rows: [['idiom', 'NVI']] },
      ],
    },
  ],
  command: [
    'Command',
    {
      panel: 'Command',
      code: ['struct Command {', '  virtual void apply(Doc&) = 0;', '  virtual void undo(Doc&) = 0;', '};', 'struct Insert : Command { size_t pos; std::string text; };', 'std::vector<std::unique_ptr<Command>> history;'],
      nodes: [
        N('ui', 40, 300, 290, 110, 'toolbar', 'user types "hi"', D('Invoker', 'Creates commands instead of editing the document directly.', 'auto cmd = std::make_unique<Insert>(pos, "hi");\ncmd->apply(doc);\nhistory.push_back(std::move(cmd));')),
        N('cmd', 355, 300, 290, 110, 'Insert "hi"', 'command object', D('Command', 'Carries everything needed to apply and to undo.', 'struct Insert : Command {\n  std::size_t pos; std::string text;\n  void apply(Doc& d) override { d.insert(pos, text); }\n  void undo(Doc& d) override {\n    d.erase(pos, text.size());\n  }\n};')),
        N('doc', 670, 300, 290, 110, 'Doc', 'receiver', D('Receiver', 'The object the command acts on.', 'struct Doc {\n  std::string s;\n  void insert(std::size_t p, std::string_view t);\n  void erase(std::size_t p, std::size_t n);\n};')),
        N('hist', 40, 500, 920, 110, 'history', '—', D('History', 'A stack of applied commands.', 'std::vector<std::unique_ptr<Command>> history;')),
        N('undo', 40, 700, 440, 110, 'undo()', 'pop + reverse', D('Undo', 'Pop the last command and ask it to reverse itself.', 'void undo_last() {\n  if (history.empty()) return;\n  history.back()->undo(doc);\n  history.pop_back();\n}')),
        N('q', 520, 700, 440, 110, 'queue / log', 'replay later', D('Queue, log, replay', 'Commands are data, so they can be serialised, queued to another thread or replayed.', 'std::queue<std::function<void()>> jobs;\njobs.push([&] { doc.insert(0, "x"); });')),
      ],
      edges: ['ui>cmd', 'cmd>doc', 'cmd>hist', 'hist>undo', 'hist>q'],
      beats: [
        { note: 'A command turns a request into an object that carries everything needed to run it later.', hl: [0, 1, 2, 3, 4], hot: { ui: 'current', cmd: 'current', 'ui>cmd': 'accent' }, hide: ['undo', 'q'], rows: [['history', 0]] },
        { note: 'apply() changes the document, and the command is pushed onto history.', hl: [1, 5], hot: { doc: 'write', hist: 'write', 'cmd>doc': 'accent', 'cmd>hist': 'accent' }, sub: { hist: '[Insert "hi"]', doc: '"hi"' }, hide: ['undo', 'q'], rows: [['history', 1]] },
        { note: 'Undo pops the last command and calls undo(), which knows exactly what to reverse.', hl: [2], hot: { undo: 'current', doc: 'write', 'hist>undo': 'accent' }, sub: { doc: '""' }, hide: ['q'], rows: [['history', 0]] },
        { note: 'The same objects can be queued, logged, sent to another thread, or replayed.', hot: { q: 'ok', 'hist>q': 'accent' }, rows: [['uses', 'undo, queue, log']] },
        { note: 'Without undo, a std::function<void()> is usually all the command you need.', hot: { q: 'current' }, rows: [['lightweight', 'std::function']] },
      ],
    },
  ],
});

// ---------------- behavioural: events ----------------
const MESH = ['w1>w2', 'w1>w3', 'w2>w4', 'w3>w4'];

boardDemo('pat-events', 'Observer, mediator, chain of responsibility', 'Notify subscribers without knowing them, avoid dangling observers, centralise coordination, and pass requests down a chain.', {
  observer: [
    'Observer',
    {
      panel: 'Observer',
      code: ['class Price {', '  std::vector<std::function<void(double)>> subs_;', 'public:', '  void subscribe(std::function<void(double)> f) {', '    subs_.push_back(std::move(f));', '  }', '  void set(double p) { for (auto& f : subs_) f(p); }', '};'],
      nodes: [
        N('subj', 355, 370, 290, 110, 'Price', 'subject', D('Subject', 'Keeps a list of callbacks and calls them on change. Knows nothing about who listens.', 'Price price;\nprice.subscribe([](double p) { std::cout << p; });\nprice.set(101.5);')),
        N('o1', 40, 580, 290, 110, 'Chart', 'observer', D('Observer: Chart', 'Redraws on each update.', 'price.subscribe([&chart](double p) {\n  chart.add_point(p);\n});')),
        N('o2', 355, 580, 290, 110, 'Alerts', 'observer', D('Observer: Alerts', 'Fires when a threshold is crossed.', 'price.subscribe([&](double p) {\n  if (p > limit) alerts.fire("high");\n});')),
        N('o3', 670, 580, 290, 110, 'Logger', 'observer', D('Observer: Logger', 'A slow observer blocks everyone else, since calls are synchronous.', 'price.subscribe([&](double p) {\n  db.insert(now(), p);  // slow!\n});')),
        N('ev', 40, 790, 920, 110, 'set(101.5)', 'notify all', D('Notification', 'set() loops over subscribers on the caller’s thread.', 'void Price::set(double p) {\n  for (auto& f : subs_) f(p);\n}')),
      ],
      edges: ['subj>o1', 'subj>o2', 'subj>o3'],
      beats: [
        { note: 'Observers register a callback with the subject.', hl: [3, 4, 5], hot: { o1: 'current', o2: 'current', o3: 'current' }, hide: ['ev'], rows: [['subscribers', 3]] },
        { note: 'When the price changes, the subject calls every subscriber in turn.', hl: [6], hot: { ev: 'current', o1: 'write', o2: 'write', o3: 'write', 'subj>o1': 'accent', 'subj>o2': 'accent', 'subj>o3': 'accent' }, rows: [['calls', 3]] },
        { note: 'The subject doesn’t know what a Chart or an Alert is, only the callback type.', hot: { subj: 'current' }, rows: [['coupling', 'callback type', 'ok']] },
        { note: 'Callbacks run synchronously on the setter’s thread, so a slow observer slows everyone.', hot: { o3: 'warn', ev: 'warn' }, rows: [['slowest', 'Logger', 'warn']] },
      ],
    },
  ],
  dangling: [
    'Dangling observer',
    {
      panel: 'Lifetime',
      code: ['auto chart = std::make_shared<Chart>();', 'price.subscribe([w = std::weak_ptr(chart)](double p) {', '  if (auto c = w.lock()) c->redraw(p);   // alive?', '});', 'chart.reset();        // window closed', 'price.set(99.0);      // callback skips it'],
      nodes: [
        N('subj', 355, 310, 290, 110, 'Price', 'holds callbacks', D('Subject', 'Outlives the chart. Its callback list still has an entry for it.', 'std::vector<std::function<void(double)>> subs_;')),
        N('cb', 40, 520, 290, 110, 'callback', 'captured this', D('The bug', 'Capturing a raw this or reference ties nothing to the observer’s lifetime.', '// dangerous:\nprice.subscribe([this](double p) {\n  redraw(p);  // this may be freed\n});')),
        N('o', 670, 520, 290, 110, 'Chart', 'owned elsewhere', D('Observer', 'Owned by the UI. It can be destroyed at any time.', 'auto chart = std::make_shared<Chart>();\nwindow.add(chart);')),
        N('ev', 40, 730, 920, 110, 'set(99.0)', 'notify', D('RAII subscription', 'Alternative fix: subscribe() returns a token that unsubscribes in its destructor.', 'class Chart {\n  Subscription sub_;  // unsubscribes in ~Subscription\npublic:\n  explicit Chart(Price& p)\n    : sub_(p.subscribe([this](double v) {\n        redraw(v); })) {}\n};')),
      ],
      edges: ['subj>cb', 'cb>o'],
      beats: [
        { note: 'The window closes and Chart is destroyed, but Price still holds a callback that captured a raw this.', hot: { o: 'fail', cb: 'warn' }, label: { o: 'Chart (freed)' }, rows: [['subscribers', 1], ['alive', 0, 'fail']] },
        { note: 'The next set() calls into freed memory. ASan reports heap-use-after-free.', hot: { ev: 'fail', cb: 'fail', 'cb>o': 'fail', 'subj>cb': 'accent' }, label: { o: 'Chart (freed)' }, rows: [['result', 'use-after-free', 'fail']] },
        { note: 'Capture a weak_ptr instead, and lock() it before use.', hl: [1, 2], hot: { cb: 'ok' }, sub: { cb: 'weak_ptr w' }, rows: [['captured', 'weak_ptr', 'ok']] },
        { note: 'Once Chart is gone lock() returns null, so the callback safely skips it.', hl: [4, 5], hot: { ev: 'ok', o: 'visited', 'subj>cb': 'accent' }, sub: { cb: 'w.lock() == null' }, label: { o: 'Chart (freed)' }, rows: [['result', 'skipped', 'ok']] },
        { note: 'Or return a subscription token whose destructor unsubscribes, so lifetimes line up by RAII.', hot: { ev: 'current' }, label: { ev: 'Subscription token' }, sub: { ev: '~Subscription() unsubscribes' }, rows: [['alternative', 'RAII token']] },
      ],
    },
  ],
  mediator: [
    'Mediator',
    {
      panel: 'Mediator',
      nodes: [
        N('w1', 40, 200, 290, 110, 'checkbox', '"custom size"', D('Colleague: checkbox', 'Reports its change to the mediator and nothing else.', 'box.on_change([&] { dialog.changed(box); });')),
        N('w2', 670, 200, 290, 110, 'text field', 'size', D('Colleague: text field', 'Doesn’t know the checkbox exists.', 'field.on_change([&] { dialog.changed(field); });')),
        N('m', 355, 445, 290, 110, 'Dialog', 'mediator', D('Mediator', 'Owns the coordination rules between widgets.', 'void Dialog::changed(Widget& w) {\n  if (&w == &box) {\n    field.enable(box.checked());\n    ok.enable(valid());\n  }\n}')),
        N('w3', 40, 690, 290, 110, 'OK button', undefined, D('Colleague: button', 'Enabled or disabled by the dialog.', 'ok.enable(false);')),
        N('w4', 670, 690, 290, 110, 'list', 'presets', D('Colleague: list', 'Filtered by the dialog when the checkbox changes.', 'list.filter(box.checked() ? "custom" : "all");')),
      ],
      edges: [...MESH, 'w1>m', 'w2>m', 'm>w3', 'm>w4'],
      beats: [
        { note: 'Widgets that update each other directly form a web where each knows the others.', hot: Object.fromEntries(MESH.map((e) => [e, 'fail'])), hide: ['m'], rows: [['links', 'n × (n − 1)', 'warn']] },
        { note: 'A mediator sits in the middle, and widgets report events to it and nothing else.', hot: { m: 'current', 'w1>m': 'accent', 'w2>m': 'accent' }, hide: MESH, rows: [['links', 'n', 'ok']] },
        { note: 'The dialog decides that checking the box enables the OK button and filters the list.', hot: { w1: 'current', w3: 'ok', w4: 'write', 'm>w3': 'accent', 'm>w4': 'accent' }, hide: MESH, rows: [['rules in', 'Dialog']] },
        { note: 'Widgets become reusable, and the coordination logic lives in one place.', hot: { m: 'ok' }, hide: MESH, rows: [['widget deps', 0, 'ok']] },
        { note: 'Watch that the mediator doesn’t grow into a god object that knows everything.', hot: { m: 'warn' }, hide: MESH, rows: [['risk', 'god object', 'warn']] },
      ],
    },
  ],
  chain: [
    'Chain of responsibility',
    {
      panel: 'Chain',
      code: ['using Handler = std::function<bool(Request&)>;', 'std::vector<Handler> chain = {auth, rate_limit, cache, app};', 'for (auto& h : chain)', '  if (h(req)) break;          // handled: stop'],
      nodes: [
        N('req', 40, 240, 920, 100, 'request', 'GET /users', D('Request', 'Passed along the chain until someone handles it.', 'struct Request {\n  std::string path, token;\n  Response resp;\n};')),
        N('h1', 40, 420, 210, 110, 'auth', undefined, D('Handler: auth', 'Rejects bad tokens (handled = true), otherwise passes.', 'bool auth(Request& r) {\n  if (!valid(r.token)) { r.resp = 401; return true; }\n  return false;\n}')),
        N('h2', 270, 420, 210, 110, 'rate limit', undefined, D('Handler: rate limit', 'Stops the request if the client is over its budget.', 'bool rate_limit(Request& r) {\n  if (!bucket.take()) { r.resp = 429; return true; }\n  return false;\n}')),
        N('h3', 500, 420, 210, 110, 'cache', undefined, D('Handler: cache', 'Answers from cache on a hit.', 'bool cache(Request& r) {\n  if (auto hit = lru.get(r.path)) {\n    r.resp = *hit; return true;\n  }\n  return false;\n}')),
        N('h4', 730, 420, 230, 110, 'app', undefined, D('Handler: app', 'The last handler always handles.', 'bool app(Request& r) {\n  r.resp = route(r);\n  return true;\n}')),
        N('res', 40, 640, 920, 110, 'response', '—', D('Middleware', 'HTTP servers call this middleware. Order is policy: auth before cache.', 'chain.insert(chain.begin() + 1, log_request);')),
      ],
      edges: ['req>h1', 'h1>h2', 'h2>h3', 'h3>h4'],
      beats: [
        { note: 'Each handler either handles a request or passes it to the next.', hl: [0, 1, 2, 3], hot: { req: 'current', 'req>h1': 'accent' }, rows: [['handlers', 4]] },
        { note: 'auth checks the token and passes it on.', hot: { h1: 'ok', 'h1>h2': 'accent' }, rows: [['auth', 'pass', 'ok']] },
        { note: 'rate limit passes, and cache finds a hit, so the chain stops there.', hot: { h1: 'ok', h2: 'ok', h3: 'current', h4: 'visited', res: 'ok', 'h2>h3': 'accent' }, sub: { res: '200 from cache' }, rows: [['handled by', 'cache', 'ok']] },
        { note: 'The sender doesn’t know which handler answers, and handlers can be reordered or added.', hot: { res: 'current' }, sub: { res: 'this is HTTP middleware' }, rows: [['coupling', 'none']] },
      ],
    },
  ],
});

// ---------------- behavioural: traversal & snapshots ----------------
boardDemo('pat-traverse', 'Iterator, visitor, std::visit, memento', 'Walk a structure without exposing it, add operations over a type hierarchy, the variant alternative, and snapshots for undo.', {
  iterator: [
    'Iterator',
    {
      panel: 'Iterator',
      code: ['for (int x : tree) sum += x;', '// expands to:', 'for (auto it = tree.begin(), e = tree.end(); it != e; ++it)', '  sum += *it;'],
      nodes: [
        N('t4', 355, 240, 290, 100, '4', 'root', D('Tree', 'A binary search tree. Its layout is private.', 'class Tree {\n  struct Node { int v; Node *l, *r, *up; };\n  Node* root_;\npublic:\n  iterator begin(); iterator end();\n};')),
        N('t2', 100, 410, 290, 100, '2', undefined, D('Node', 'Iteration order is in-order: left, self, right.', '// in-order: 1 2 3 4 6')),
        N('t6', 610, 410, 290, 100, '6', undefined, D('Node', 'Visited last.', '// ++it from 4 goes to 6')),
        N('t1', 40, 580, 260, 100, '1', undefined, D('Node', 'begin() points at the leftmost node.', 'iterator begin() { return leftmost(root_); }')),
        N('t3', 320, 580, 260, 100, '3', undefined, D('Node', 'After 3, ++it climbs to 4.', '// successor: go up until coming from the left')),
        N('it', 40, 780, 920, 110, 'iterator', '—', D('Iterator', 'Small object with *, ++ and ==. That’s all a range-for and STL algorithms need.', 'struct iterator {\n  Node* n;\n  int& operator*() const { return n->v; }\n  iterator& operator++() { n = successor(n); return *this; }\n  bool operator==(const iterator&) const = default;\n};')),
      ],
      edges: ['t4>t2', 't4>t6', 't2>t1', 't2>t3'],
      beats: [
        { note: 'Any type with begin() and end() works in a range-for.', hl: [0], rows: [['needs', 'begin, end, ++, *, !=']] },
        { note: 'The iterator hides the traversal, and ++it walks the tree in order.', hl: [2], hot: { t1: 'current', it: 'current' }, sub: { it: 'at 1' }, rows: [['sum', 1]] },
        { note: 'Next it moves to 2, then 3, without the loop knowing it’s a tree.', hl: [3], hot: { t1: 'visited', t2: 'visited', t3: 'current', it: 'current' }, sub: { it: 'at 3' }, rows: [['sum', 6]] },
        { note: 'All STL algorithms work on iterators, so they work on your tree too.', hot: { t1: 'ok', t2: 'ok', t3: 'ok', t4: 'ok', t6: 'ok', it: 'ok' }, sub: { it: 'sum = 16' }, rows: [['sum', 16, 'ok']] },
      ],
    },
  ],
  visitor: [
    'Visitor',
    {
      panel: 'Visitor',
      code: ['struct Visitor {', '  virtual void visit(Num&) = 0;', '  virtual void visit(Add&) = 0;', '};', 'struct Num : Expr {', '  void accept(Visitor& v) override { v.visit(*this); }', '};'],
      nodes: [
        N('add', 355, 330, 290, 100, 'Add', 'Expr', D('Element', 'Each node class implements accept(), which calls back into the visitor with its real type.', 'void Add::accept(Visitor& v) { v.visit(*this); }')),
        N('n1', 100, 490, 290, 100, 'Num 2', 'Expr', D('Element', 'A leaf node.', 'struct Num : Expr { double v; };')),
        N('n2', 610, 490, 290, 100, 'Num 3', 'Expr', D('Element', 'Another leaf.', 'Add{std::make_unique<Num>(2),\n    std::make_unique<Num>(3)}')),
        N('ev', 40, 680, 440, 110, 'Evaluate', 'result: —', D('Visitor: Evaluate', 'One operation over all node types, in one class.', 'struct Evaluate : Visitor {\n  double r = 0;\n  void visit(Num& n) override { r = n.v; }\n  void visit(Add& a) override {\n    a.l->accept(*this); double x = r;\n    a.r->accept(*this); r += x;\n  }\n};')),
        N('pr', 520, 680, 440, 110, 'Print', 'result: —', D('Visitor: Print', 'A second operation added without editing Num or Add.', 'struct Print : Visitor {\n  void visit(Num& n) override { out << n.v; }\n  void visit(Add& a) override;  // "l + r"\n};')),
        N('cost', 40, 850, 920, 110, 'double dispatch', 'accept → visit', D('Double dispatch', 'Two virtual calls pick the function by both the node type and the visitor type.', 'expr.accept(eval);  // vcall 1: which node?\n// inside: v.visit(*this) → vcall 2: which visitor?')),
      ],
      edges: ['add>n1', 'add>n2'],
      beats: [
        { note: 'Visitor adds operations to a fixed class hierarchy without editing each class.', hot: { add: 'current' }, hide: ['cost'], rows: [['node types', 2], ['operations', 2]] },
        { note: 'accept() dispatches on the node type, then visit() on the visitor type, which is double dispatch.', hl: [5], hot: { cost: 'current' }, rows: [['virtual calls', 2]] },
        { note: 'Evaluate walks the tree and returns 5.', hot: { ev: 'ok', add: 'write', n1: 'write', n2: 'write' }, sub: { ev: 'result: 5' }, rows: [['Evaluate', 5, 'ok']] },
        { note: 'Print is a second visitor over the same classes.', hot: { pr: 'ok' }, sub: { ev: 'result: 5', pr: 'result: "2 + 3"' }, rows: [['Print', '"2 + 3"', 'ok']] },
        { note: 'A new node type means editing every visitor. Pick visitor when operations change more often than types.', hot: { cost: 'warn' }, sub: { ev: 'result: 5', pr: 'result: "2 + 3"' }, rows: [['cheap to add', 'operations'], ['costly to add', 'types', 'warn']] },
      ],
    },
  ],
  variant: [
    'std::variant + visit',
    {
      panel: 'variant',
      code: ['using Shape = std::variant<Circle, Square>;', 'double area(const Shape& s) {', '  return std::visit(overloaded{', '    [](const Circle& c) { return 3.14159 * c.r * c.r; },', '    [](const Square& q) { return q.side * q.side; },', '  }, s);', '}'],
      nodes: [
        N('var', 355, 330, 290, 110, 'Shape', 'variant, 16 B', D('std::variant', 'Holds exactly one of its alternatives inline, plus a small index. No heap.', 'Shape s = Circle{2.0};\ns = Square{3.0};           // now a Square\nstd::size_t i = s.index(); // 1')),
        N('c', 40, 530, 440, 110, 'Circle', 'plain struct', D('Alternative', 'Plain value types: no base class, no virtual functions.', 'struct Circle { double r; };')),
        N('q', 520, 530, 440, 110, 'Square', 'plain struct', D('Alternative', 'Copyable, comparable, cache-friendly in a vector.', 'struct Square { double side; };\nstd::vector<Shape> shapes;  // contiguous')),
        N('tag', 40, 730, 440, 110, 'index()', 'which alternative', D('The tag', 'std::visit switches on it, like a hidden jump table.', 'if (std::holds_alternative<Circle>(s)) …')),
        N('cost', 520, 730, 440, 110, 'no heap', 'no vtable', D('overloaded helper', 'The usual C++17 helper that merges lambdas into one visitor.', 'template <class... Ts>\nstruct overloaded : Ts... {\n  using Ts::operator()...;\n};')),
      ],
      edges: ['var>c', 'var>q'],
      beats: [
        { note: 'A closed set of types fits in one std::variant, stored inline with a small tag.', hl: [0], hot: { var: 'current', tag: 'current' }, rows: [['sizeof', '16 B']] },
        { note: 'std::visit jumps on the tag to the matching lambda.', hl: [2, 3], hot: { c: 'current', 'var>c': 'accent' }, rows: [['area(Circle{2})', '12.57']] },
        { note: 'Forget a case and it won’t compile, a promise a class hierarchy can’t make.', hl: [4], hot: { q: 'current', 'var>q': 'accent' }, rows: [['exhaustive', 'yes', 'ok']] },
        { note: 'No heap allocation and no virtual call. Adding a new type is the hard part, just as with visitor.', hot: { cost: 'ok' }, rows: [['alloc', 0, 'ok'], ['vcalls', 0, 'ok']] },
      ],
    },
  ],
  memento: [
    'Memento',
    {
      panel: 'Memento',
      code: ['struct Editor {', '  std::string text; std::size_t cursor;', '  struct Snapshot { std::string text; std::size_t cursor; };', '  Snapshot save() const { return {text, cursor}; }', '  void restore(const Snapshot& s) {', '    text = s.text; cursor = s.cursor;', '  }', '};'],
      nodes: [
        N('ed', 40, 370, 440, 110, 'Editor', '"hello|"', D('Originator', 'Knows how to save and restore its own state.', 'Editor e;\nauto snap = e.save();\ne.text += " world";\ne.restore(snap);')),
        N('snap', 520, 370, 440, 110, 'Snapshot', 'opaque copy', D('Memento', 'A value copy of the state. Callers store it but don’t poke inside.', 'struct Snapshot {\n  std::string text;\n  std::size_t cursor;\n};')),
        N('stack', 40, 580, 920, 110, 'undo stack', '—', D('Caretaker', 'Holds snapshots, never looks into them.', 'std::vector<Editor::Snapshot> undo;\nundo.push_back(e.save());')),
        N('res', 40, 790, 920, 110, 'after restore', '—', D('Big state', 'For large documents, store diffs or use persistent (structurally shared) data instead of full copies.', '// immer::vector, ropes, or a command log')),
      ],
      edges: ['ed>snap', 'snap>stack'],
      beats: [
        { note: 'Before a risky edit, the editor saves a snapshot of its own state.', hl: [3], hot: { ed: 'current', snap: 'write', 'ed>snap': 'accent' }, hide: ['res'], rows: [['snapshots', 1]] },
        { note: 'Callers keep snapshots without seeing inside, so the editor’s invariants stay private.', hot: { stack: 'current', 'snap>stack': 'accent' }, sub: { stack: '[Snapshot "hello|"]', ed: '"hello world|"' }, hide: ['res'], rows: [['snapshots', 1]] },
        { note: 'Undo restores the snapshot in one step.', hl: [4, 5, 6], hot: { res: 'ok', ed: 'ok' }, sub: { ed: '"hello|"', res: '"hello|"' }, rows: [['restored', 'yes', 'ok']] },
        { note: 'Full snapshots of big state get expensive, so store diffs or use persistent data structures.', hot: { res: 'warn' }, sub: { res: 'copy per save' }, rows: [['cost', 'O(state) per save', 'warn']] },
      ],
    },
  ],
});

// ---------------- C++ idioms ----------------
boardDemo('pat-idioms', 'C++ idioms', 'RAII guards, CRTP, policy-based design, type erasure, NVI and dependency injection: the patterns real C++ codebases lean on.', {
  raii: [
    'RAII guard',
    {
      panel: 'RAII',
      code: ['{', '  std::lock_guard lock(mu);   // locks here', '  if (queue.empty()) return;  // unlocks here', '  process(queue.front());     // throws? unlocks', '}                             // unlocks here'],
      nodes: [
        N('mu', 355, 260, 290, 110, 'mutex mu', 'unlocked', D('Resource', 'Anything that must be released: a mutex, file, socket, transaction.', 'std::mutex mu;\nstd::deque<Job> queue;')),
        N('g', 355, 440, 290, 110, 'lock_guard', 'on the stack', D('Guard object', 'Constructor acquires, destructor releases. The compiler runs the destructor on every exit path.', 'template <class M>\nstruct lock_guard {\n  M& m;\n  explicit lock_guard(M& m) : m(m) { m.lock(); }\n  ~lock_guard() { m.unlock(); }\n};')),
        N('e1', 40, 640, 290, 110, 'return', 'early exit', D('Early return', 'No unlock() needed before returning.', 'if (queue.empty()) return;')),
        N('e2', 355, 640, 290, 110, 'throw', 'stack unwinding', D('Exception', 'Unwinding runs destructors of every local, so the guard still unlocks.', 'process(job);  // throws std::runtime_error')),
        N('e3', 670, 640, 290, 110, 'end of scope', '}', D('Normal exit', 'The closing brace ends the guard’s lifetime.', '}  // ~lock_guard() runs here')),
        N('dtor', 40, 840, 920, 110, '~lock_guard()', 'mu.unlock()', D('Your own guard', 'Wrap any C API with a close() the same way.', 'struct File {\n  FILE* f;\n  explicit File(const char* p) : f(fopen(p, "r")) {}\n  ~File() { if (f) fclose(f); }\n  File(const File&) = delete;\n};')),
      ],
      edges: ['g>mu', 'g>e1', 'g>e2', 'g>e3', 'e1>dtor', 'e2>dtor', 'e3>dtor'],
      beats: [
        { note: 'RAII ties a resource to an object’s lifetime, acquiring in the constructor and releasing in the destructor.', hl: [1], hot: { g: 'current', mu: 'warn', 'g>mu': 'accent' }, sub: { mu: 'locked' }, hide: ['dtor'], rows: [['mu', 'locked', 'warn']] },
        { note: 'However the scope ends, by return, exception or the closing brace, the destructor runs.', hl: [2, 3, 4], hot: { e1: 'write', e2: 'write', e3: 'write', 'g>e1': 'accent', 'g>e2': 'accent', 'g>e3': 'accent' }, sub: { mu: 'locked' }, rows: [['exit paths', 3]] },
        { note: 'So the mutex is always unlocked, with no cleanup code on any path.', hot: { dtor: 'ok', mu: 'ok', 'e1>dtor': 'accent', 'e2>dtor': 'accent', 'e3>dtor': 'accent' }, rows: [['mu', 'unlocked', 'ok'], ['cleanup lines', 0, 'ok']] },
        { note: 'Write your own guards for anything with a close(), from files and sockets to transactions and timers.', hot: { dtor: 'current' }, label: { dtor: 'your own guard' }, sub: { dtor: 'File, Socket, Txn' }, rows: [['rule', 'no naked close()']] },
      ],
    },
  ],
  crtp: [
    'CRTP',
    {
      panel: 'CRTP',
      code: ['template <class D> struct Shape {', '  double area() const {', '    return static_cast<const D&>(*this).area_impl();', '  }', '};', 'struct Sq : Shape<Sq> {', '  double s;', '  double area_impl() const { return s * s; }', '};'],
      nodes: [
        N('base', 355, 380, 290, 110, 'Shape<Sq>', 'template base', D('CRTP base', 'Knows the derived type at compile time, so it can call into it without virtuals.', 'template <class D>\nstruct Shape {\n  double area() const {\n    return static_cast<const D&>(*this).area_impl();\n  }\n};')),
        N('d', 355, 590, 290, 110, 'Sq', 'derived', D('Derived', 'Passes itself as the template argument: the curiously recurring template pattern.', 'struct Sq : Shape<Sq> {\n  double s;\n  double area_impl() const { return s * s; }\n};')),
        N('call', 40, 800, 440, 110, 'sq.area()', 'inlined', D('The call', 'Resolved at compile time; the optimiser sees straight through it.', 'Sq q{3};\ndouble a = q.area();  // compiles to 9.0')),
        N('vt', 520, 800, 440, 110, 'vtable', 'none', D('C++23 alternative', 'Deducing this gives the same static dispatch without a template base.', 'struct Shape {\n  double area(this const auto& self) {\n    return self.area_impl();\n  }\n};')),
      ],
      edges: ['d>base'],
      beats: [
        { note: 'In CRTP a class passes itself as the template argument to its base.', hl: [5], hot: { d: 'current', base: 'current', 'd>base': 'accent' }, hide: ['call', 'vt'], rows: [['base knows', 'Sq']] },
        { note: 'The base casts this to the derived type, so the call is resolved at compile time.', hl: [2], hot: { base: 'write' }, hide: ['call', 'vt'], rows: [['dispatch', 'static', 'ok']] },
        { note: 'There’s no vtable and no indirect call, so the compiler inlines area_impl().', hl: [7], hot: { call: 'ok', vt: 'ok' }, rows: [['vptr', 'none', 'ok']] },
        { note: 'The trade-off is no runtime polymorphism, so different Shapes can’t share one container.', hot: { vt: 'warn' }, sub: { vt: 'no vector<Shape*>' }, rows: [['runtime choice', 'no', 'warn']] },
        { note: 'C++23 deducing this gives the same result without the template base.', hot: { vt: 'current' }, label: { vt: 'this auto& self' }, sub: { vt: 'C++23' }, rows: [['newer', 'deducing this']] },
      ],
    },
  ],
  policy: [
    'Policy-based design',
    {
      panel: 'Policies',
      code: ['template <class Lock, class Alloc = std::allocator<char>>', 'class Buffer {', '  Lock lock_;          // NullLock or std::mutex', '  Alloc alloc_;', '};', 'Buffer<NullLock> fast;            // single-threaded', 'Buffer<std::mutex> shared;        // thread-safe'],
      nodes: [
        N('buf', 355, 340, 290, 110, 'Buffer<L, A>', 'host class', D('Host class', 'Written once, parameterised by the behaviours it needs.', 'template <class Lock, class Alloc>\nvoid Buffer<Lock, Alloc>::push(char c) {\n  std::scoped_lock g(lock_);\n  data_.push_back(c);\n}')),
        N('l1', 40, 540, 290, 110, 'NullLock', 'no-op', D('Policy: NullLock', 'Empty lock()/unlock() that compile to nothing.', 'struct NullLock {\n  void lock() {}\n  void unlock() {}\n};')),
        N('l2', 355, 540, 290, 110, 'std::mutex', 'real lock', D('Policy: std::mutex', 'Same interface, real locking.', 'Buffer<std::mutex> shared;  // safe across threads')),
        N('a1', 670, 540, 290, 110, 'Alloc', 'pluggable', D('Standard policies', 'The standard library is full of these: allocators, hashers, comparators, deleters.', 'std::unordered_map<K, V, MyHash, MyEq, Arena<…>> m;\nstd::unique_ptr<FILE, decltype(&fclose)> f{fopen(p, "r"), fclose};')),
        N('b1', 40, 740, 440, 110, 'Buffer<NullLock>', '0 overhead', D('Instantiation', 'Locking compiles away completely.', 'Buffer<NullLock> b;  // same speed as no locking')),
        N('b2', 520, 740, 440, 110, 'Buffer<mutex>', 'thread-safe', D('Instantiation', 'A different type from Buffer<NullLock>, so they can’t mix.', 'static_assert(!std::is_same_v<\n  Buffer<NullLock>, Buffer<std::mutex>>);')),
      ],
      edges: ['buf>l1', 'buf>l2', 'buf>a1'],
      beats: [
        { note: 'Policy-based design picks behaviour through template parameters.', hl: [0, 1, 2, 3, 4], hot: { buf: 'current' }, hide: ['b1', 'b2'], rows: [['policies', 2]] },
        { note: 'Buffer<NullLock> compiles its locking away entirely.', hl: [5], hot: { l1: 'current', b1: 'ok', 'buf>l1': 'accent' }, hide: ['b2'], rows: [['lock cost', 0, 'ok']] },
        { note: 'Buffer<std::mutex> is the same code with real locking.', hl: [6], hot: { l2: 'current', b2: 'ok', 'buf>l2': 'accent' }, rows: [['lock cost', 'uncontended ~20 ns']] },
        { note: 'The standard library does this everywhere, with allocators, hashers, comparators and deleters.', hot: { a1: 'current', 'buf>a1': 'accent' }, rows: [['cost', 'compile time, code size', 'warn']] },
      ],
    },
  ],
  erasure: [
    'Type erasure',
    {
      panel: 'Type erasure',
      code: ['std::function<int(int)> f = [k = 3](int x) { return x * k; };', '// inside std::function, roughly:', 'struct Concept { virtual int call(int) = 0; };', 'template <class F> struct Model : Concept {', '  F fn;', '  int call(int x) override { return fn(x); }', '};'],
      nodes: [
        N('fn', 40, 340, 290, 110, 'std::function', 'one type', D('Erased wrapper', 'One concrete type that can hold any callable with the right signature.', 'std::vector<std::function<int(int)>> fs;\nfs.push_back([](int x) { return x + 1; });\nfs.push_back(&twice);')),
        N('co', 355, 340, 290, 110, 'Concept', 'hidden interface', D('Concept', 'A private abstract interface: the operations the wrapper needs.', 'struct Concept {\n  virtual ~Concept() = default;\n  virtual int call(int) = 0;\n  virtual std::unique_ptr<Concept> clone() const = 0;\n};')),
        N('mo', 670, 340, 290, 110, 'Model<Lambda>', 'wraps the lambda', D('Model', 'A template that adapts any F to the Concept. Instantiated per callable type.', 'template <class F>\nstruct Model : Concept {\n  F fn;\n  int call(int x) override { return fn(x); }\n};')),
        N('lam', 670, 540, 290, 110, 'lambda', 'k = 3', D('The callable', 'Just a closure object with operator(). Its type is unnamed.', 'auto f = [k = 3](int x) { return x * k; };\n// sizeof(f) == 4')),
        N('sbo', 40, 540, 580, 110, 'small buffer', 'fits inline: no heap', D('Small-buffer optimisation', 'Small callables are stored inside the std::function; big captures are heap-allocated.', '// typical inline capacity: 16–32 bytes\nstd::function<void()> g = [big = std::array<char, 256>{}] {};\n// → heap allocation')),
        N('call', 40, 740, 920, 110, 'f(5)', '→ 15', D('Your own erased type', 'The same trick gives value-semantic polymorphism for your own interfaces.', 'class Drawable {\n  std::unique_ptr<Concept> p_;\npublic:\n  template <class T>\n  Drawable(T t) : p_(new Model<T>{std::move(t)}) {}\n  void draw() const { p_->draw(); }\n};')),
      ],
      edges: ['fn>co', 'mo>co', 'mo>lam'],
      beats: [
        { note: 'std::function stores any callable with the right signature behind one type.', hl: [0], hot: { fn: 'current' }, hide: ['call'], rows: [['types held', 'any callable']] },
        { note: 'Inside, a template Model<F> implements a hidden virtual interface.', hl: [2, 3, 4, 5], hot: { co: 'current', mo: 'current', 'mo>co': 'accent' }, hide: ['call'], rows: [['vtables', 'one per F']] },
        { note: 'Small callables live in an inline buffer, and bigger ones go on the heap.', hot: { sbo: 'current', lam: 'write', 'mo>lam': 'accent' }, hide: ['call'], rows: [['heap', 'no (4 B capture)', 'ok']] },
        { note: 'Calling f(5) is one indirect call into Model<Lambda>::call.', hot: { call: 'ok', 'fn>co': 'accent', 'mo>co': 'accent', 'mo>lam': 'accent' }, rows: [['result', 15, 'ok'], ['vcalls', 1]] },
        { note: 'std::any, std::function and your own Drawable all use this for value-semantic polymorphism.', hot: { call: 'current' }, label: { call: 'class Drawable' }, sub: { call: 'your own erased type' }, rows: [['no base class', 'needed', 'ok']] },
      ],
    },
  ],
  nvi: [
    'Non-virtual interface',
    {
      panel: 'NVI',
      code: ['class Storage {', 'public:', '  void write(Key k, Bytes v) {        // non-virtual', '    check(k); auto t = timer();', '    do_write(k, std::move(v));        // hook', '    metrics.record(t);', '  }', 'private:', '  virtual void do_write(Key, Bytes) = 0;', '};'],
      nodes: [
        N('pub', 355, 440, 290, 110, 'write()', 'public, non-virtual', D('Public entry point', 'Fixed behaviour every caller gets, whatever the backend.', 'storage.write("user:1", bytes);')),
        N('pre', 40, 640, 290, 110, 'check + timer', 'before', D('Pre-conditions', 'Validation lives in one place.', 'void check(const Key& k) {\n  if (k.empty()) throw std::invalid_argument("key");\n}')),
        N('dw', 355, 640, 290, 110, 'do_write()', 'private virtual', D('Customisation point', 'The only thing subclasses provide.', 'private:\n  virtual void do_write(Key, Bytes) = 0;')),
        N('post', 670, 640, 290, 110, 'metrics', 'after', D('Post-processing', 'Metrics and logging added once for all backends.', 'metrics.record("storage.write", t.elapsed());')),
        N('s3', 355, 840, 290, 110, 'S3Storage', 'overrides do_write', D('Backend', 'Can’t skip validation or metrics.', 'struct S3Storage : Storage {\nprivate:\n  void do_write(Key k, Bytes v) override {\n    s3_.put(bucket_, k, v);\n  }\n};')),
      ],
      edges: ['pub>pre', 'pub>dw', 'pub>post', 's3>dw'],
      beats: [
        { note: 'In the non-virtual interface idiom, the public method is fixed and only a private hook is virtual.', hl: [2, 8], hot: { pub: 'current' }, hide: ['s3'], rows: [['virtual', 'do_write only']] },
        { note: 'Every write gets validation and metrics, whichever backend runs.', hl: [3, 5], hot: { pre: 'write', post: 'write', 'pub>pre': 'accent', 'pub>post': 'accent' }, hide: ['s3'], rows: [['checks', 'always', 'ok']] },
        { note: 'S3Storage overrides only do_write(). It can’t skip the checks.', hl: [4], hot: { s3: 'current', dw: 'current', 's3>dw': 'accent', 'pub>dw': 'accent' }, rows: [['backends', 1]] },
        { note: 'The base class keeps its invariants, and logging can later be added in one place.', hot: { pub: 'ok' }, rows: [['places to edit', 1, 'ok']] },
      ],
    },
  ],
  di: [
    'Dependency injection',
    {
      panel: 'DI',
      code: ['class Checkout {', '  PaymentGateway& pay_;', '  Clock& clock_;', 'public:', '  Checkout(PaymentGateway& p, Clock& c)', '    : pay_(p), clock_(c) {}', '};'],
      nodes: [
        N('co', 355, 340, 290, 110, 'Checkout', 'business logic', D('Class under test', 'Receives what it needs; creates nothing it depends on.', 'Receipt Checkout::buy(Cart c) {\n  auto id = pay_.charge(c.total());\n  return {id, clock_.now()};\n}')),
        N('pg', 40, 540, 290, 110, 'PaymentGateway', 'interface', D('Seam', 'An interface at the boundary to the outside world.', 'struct PaymentGateway {\n  virtual ~PaymentGateway() = default;\n  virtual ChargeId charge(Money) = 0;\n};')),
        N('cl', 670, 540, 290, 110, 'Clock', 'interface', D('Seam', 'Time is a dependency too; tests need to control it.', 'struct Clock {\n  virtual Time now() const = 0;\n};')),
        N('prod', 40, 760, 440, 110, 'main()', 'Stripe + SystemClock', D('Composition root', 'The one place that builds real objects and wires them together.', 'int main() {\n  StripeGateway pay{api_key()};\n  SystemClock clock;\n  Checkout co{pay, clock};\n  serve(co);\n}')),
        N('test', 520, 760, 440, 110, 'test', 'FakePay + FixedClock', D('Test wiring', 'Fakes make the test fast, deterministic and offline.', 'FakePay pay;\nFixedClock clock{"2026-01-01T00:00"};\nCheckout co{pay, clock};\nEXPECT_EQ(co.buy(cart).time, clock.t);')),
      ],
      edges: ['co>pg', 'co>cl', 'prod>co', 'test>co'],
      beats: [
        { note: 'Checkout gets its dependencies through the constructor instead of creating them.', hl: [4, 5], hot: { co: 'current', 'co>pg': 'accent', 'co>cl': 'accent' }, hide: ['prod', 'test'], rows: [['deps in signature', 2, 'ok']] },
        { note: 'Production wires the real Stripe gateway and system clock in main().', hot: { prod: 'current', 'prod>co': 'accent' }, hide: ['test'], rows: [['wired in', 'main()']] },
        { note: 'Tests pass fakes, so there’s no network and time is whatever the test says.', hot: { test: 'ok', 'test>co': 'accent' }, rows: [['test speed', '< 1 ms', 'ok']] },
        { note: 'Dependencies are visible in the signature, the opposite of a singleton.', hot: { co: 'ok' }, rows: [['hidden deps', 0, 'ok']] },
        { note: 'On hot paths, a template parameter gives the same seam with no virtual call.', hot: { pg: 'current', cl: 'current' }, rows: [['alt', 'template <class Pay>']] },
      ],
    },
  ],
});

// ---------------- value vs reference semantics ----------------
const VALUES: Record<string, Trace> = {
  value: {
    code: ['std::vector<int> a = {1, 2, 3};', 'std::vector<int> b = a;      // copy', 'b.push_back(4);', 'print(a); print(b);'],
    panel: 'Semantics',
    details: {
      a: { title: 'a (value)', text: 'A vector object on the stack: pointer, size and capacity. It owns its heap buffer.', code: 'sizeof(std::vector<int>) == 24  // 3 pointers' },
      b: { title: 'b (a copy)', text: 'Copying a vector copies its elements into a new buffer. b and a are independent.', code: 'std::vector<int> b = a;  // deep copy, O(n)' },
      ha: { title: 'a’s buffer', text: 'Freed when a goes out of scope.', code: '// a.data() points here' },
      hb: { title: 'b’s buffer', text: 'A separate allocation. Changing it can’t affect a.', code: 'assert(a.data() != b.data());' },
    },
    steps: [
      { line: 0, note: 'a owns its elements in a heap buffer.', vars: [['a', 'size 3', 'current', 'ha']], heap: [['ha', '[1, 2, 3]', 'write']], out: '', rows: [['buffers', 1]] },
      { line: 1, note: 'Copying a value type copies the elements too, so b owns a separate buffer.', vars: [['a', 'size 3', 'default', 'ha'], ['b', 'size 3', 'current', 'hb']], heap: [['ha', '[1, 2, 3]'], ['hb', '[1, 2, 3]', 'write']], out: '', rows: [['buffers', 2]] },
      { line: 2, note: 'Changing b can’t affect a.', vars: [['a', 'size 3', 'default', 'ha'], ['b', 'size 4', 'current', 'hb']], heap: [['ha', '[1, 2, 3]'], ['hb', '[1, 2, 3, 4]', 'write']], out: '', rows: [['aliasing', 'none', 'ok']] },
      { line: 3, note: 'Values are easy to reason about, with no aliasing and no shared lifetime.', vars: [['a', 'size 3', 'ok', 'ha'], ['b', 'size 4', 'ok', 'hb']], heap: [['ha', '[1, 2, 3]', 'ok'], ['hb', '[1, 2, 3, 4]', 'ok']], out: '1 2 3\n1 2 3 4', rows: [['cost', 'copy is O(n)', 'warn']] },
    ],
  },
  reference: {
    code: ['auto a = std::make_shared<std::vector<int>>(', '    std::vector<int>{1, 2, 3});', 'auto b = a;                  // shares', 'b->push_back(4);', 'print(*a);'],
    panel: 'Semantics',
    details: {
      a: { title: 'a (shared_ptr)', text: 'A pointer plus a pointer to a control block holding the reference count.', code: 'sizeof(std::shared_ptr<T>) == 16' },
      b: { title: 'b (same object)', text: 'Copying a shared_ptr bumps the count atomically and aliases the same vector.', code: 'assert(a.get() == b.get());\nassert(a.use_count() == 2);' },
      hv: { title: 'The shared vector', text: 'Lives until the last shared_ptr to it is gone. Any holder can change it.', code: '// make_shared: one allocation for\n// control block + vector' },
    },
    steps: [
      { line: [0, 1], note: 'a is a pointer to a shared vector.', vars: [['a', 'shared_ptr', 'current', 'hv']], heap: [['hv', '[1, 2, 3]', 'write', 'use_count 1']], out: '', rows: [['objects', 1]] },
      { line: 2, note: 'Copying the pointer shares the object, so both names alias it.', vars: [['a', 'shared_ptr', 'default', 'hv'], ['b', 'shared_ptr', 'current', 'hv']], heap: [['hv', '[1, 2, 3]', 'write', 'use_count 2']], out: '', rows: [['objects', 1], ['names', 2, 'warn']] },
      { line: 3, note: 'Changing it through b changes what a sees.', vars: [['a', 'shared_ptr', 'warn', 'hv'], ['b', 'shared_ptr', 'current', 'hv']], heap: [['hv', '[1, 2, 3, 4]', 'warn', 'use_count 2']], out: '', rows: [['aliasing', 'yes', 'warn']] },
      { line: 4, note: 'Reference semantics suit things with identity, like a connection, and values suit data.', vars: [['a', 'shared_ptr', 'default', 'hv'], ['b', 'shared_ptr', 'default', 'hv']], heap: [['hv', '[1, 2, 3, 4]', 'default', 'use_count 2']], out: '1 2 3 4', rows: [['rule', 'values by default']] },
    ],
  },
};

machineDemo({
  slug: 'pat-values',
  title: 'Value vs reference semantics',
  group: G,
  summary: 'Copying a vector copies its elements; copying a shared_ptr aliases one object. When to use which.',
  inputs: [
    { id: 'value', label: 'Value (vector)', data: { k: 'value' } },
    { id: 'reference', label: 'Reference (shared_ptr)', data: { k: 'reference' } },
  ],
  build: ({ k }: { k: string }) => traceFrames(VALUES[k]),
});
