import { topics, type TopicDef } from '@dsims/content';

export type LangId = NonNullable<TopicDef['language']>;

export const LANGUAGES: { id: LangId; name: string; icon: string; blurb: string }[] = [
  { id: 'cpp', name: 'C++', icon: 'brand:cpp', blurb: 'From basics to CMake, large projects and C10K servers.' },
  { id: 'go', name: 'Go', icon: 'brand:go', blurb: 'Goroutines, channels, the scheduler and GC, modules.' },
  { id: 'python', name: 'Python', icon: 'brand:python', blurb: 'The interpreter, GIL, reference counting and GC, imports and pip.' },
  { id: 'java', name: 'Java', icon: 'brand:java', blurb: 'The JVM, class loading, JIT tiers, GC and Maven/Gradle.' },
  { id: 'rust', name: 'Rust', icon: 'brand:rust', blurb: 'Ownership, borrowing, lifetimes, traits, async and Cargo.' },
  { id: 'csharp', name: 'C#', icon: 'brand:csharp', blurb: 'The CLR, JIT, GC generations, async/await and NuGet.' },
  { id: 'fp', name: 'Functional programming', icon: 'lambda', blurb: 'Purity, closures, recursion, laziness, algebraic types and monads.' },
];

export const langTopics = (id: LangId) => topics.filter(t => t.group === 'languages' && t.language === id).sort((a, b) => a.order - b.order);
export const langName = (id: string) => LANGUAGES.find(l => l.id === id)?.name ?? id;
